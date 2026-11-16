// The experimental 3D homepage: one long wall the camera walks along as the page scrolls.
// Everything still either stands on a plank or hangs from a string, like the 2D site.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildNixFigure, type NixClip } from './nix-figure';

interface SceneData {
	projects: { title: string; tagline: string; language: string; commits: number; href: string }[];
	posts: { title: string; description: string; date: string; href: string }[];
	comics: { title: string; href: string; image: string }[];
	art: { thinking: string; nap: string; nix: { body: string; legL: string; legR: string; blink: string; model: string } };
}

/** Where the camera looks at each stop, and how much of the wall it needs to fit. */
interface Stop {
	center: THREE.Vector3;
	width: number;
	height: number;
	/** Where Nixchan sits while this stop is in view. */
	perch: THREE.Vector3;
	/** Where the 3D figure sits instead, when the flat perch has no room for her depth. */
	perch3d?: THREE.Vector3;
	/** Sideways camera swing, so the depth shows. */
	swing: number;
}

interface Pickable {
	object: THREE.Object3D;
	label: string;
	href?: string;
	external?: boolean;
	onHover?: () => void;
	onClick?: () => void;
}

const WALL_Z = -2;
const FLOOR_Y = -5.5;
const STOP_GAP = 24;
const LANGUAGE_COLORS: Record<string, string> = {
	Rust: '#d39a6a',
	C: '#8a9bb0',
	'C++': '#c27a9a',
	JavaScript: '#e0c264',
	TypeScript: '#6f93c4',
	Python: '#6f9a8e',
};

const DISPLAY = '"Bagel Fat One", "Noto Sans KR", sans-serif';
const SANS = 'Nunito, "Noto Sans KR", sans-serif';

// ---------- small helpers ----------

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const color = (name: string) => new THREE.Color(css(name) || '#888');
const smooth = (t: number) => t * t * (3 - 2 * t);
const damp = (from: number, to: number, rate: number, dt: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-rate * dt));

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (ctx.measureText(next).width > maxWidth && line) {
			lines.push(line);
			line = word;
			if (lines.length === maxLines) break;
		} else {
			line = next;
		}
	}
	if (lines.length < maxLines && line) lines.push(line);
	if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
		let last = lines[maxLines - 1];
		while (ctx.measureText(`${last}…`).width > maxWidth && last.length) last = last.slice(0, -1);
		lines[maxLines - 1] = `${last.trimEnd()}…`;
	}
	return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

/** A canvas texture that can be redrawn when day turns to night. */
function paintedTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	const repaint = () => {
		ctx.clearRect(0, 0, width, height);
		paint(ctx);
		texture.needsUpdate = true;
	};
	repaint();
	return { texture, repaint };
}

function loadTexture(loader: THREE.TextureLoader, url: string) {
	const texture = loader.load(url);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

/** Crops a loaded texture to fill a square, like `object-fit: cover`. */
function coverSquare(texture: THREE.Texture) {
	const image = texture.image as HTMLImageElement | undefined;
	if (!image?.width) return;
	const aspect = image.width / image.height;
	if (aspect > 1) {
		texture.repeat.set(1 / aspect, 1);
		texture.offset.set((1 - 1 / aspect) / 2, 0);
	} else {
		texture.repeat.set(1, aspect);
		texture.offset.set(0, (1 - aspect) / 2);
	}
	texture.needsUpdate = true;
}

/** A damped spring, for things that swing or bounce. */
class Spring {
	value = 0;
	velocity = 0;
	constructor(
		private stiffness: number,
		private damping: number,
	) {}
	step(dt: number, target = 0) {
		const force = -this.stiffness * (this.value - target) - this.damping * this.velocity;
		this.velocity += force * dt;
		this.value += this.velocity * dt;
		return this.value;
	}
}

// ---------- the scene ----------

export async function start() {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	const dataNode = document.querySelector('[data-scene]');
	if (!canvas || !dataNode) return;
	const data: SceneData = JSON.parse(dataNode.textContent || '{}');

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	} catch {
		document.documentElement.classList.add('no-3d');
		return;
	}
	document.documentElement.classList.add('has-3d');

	// Canvas text needs the site's fonts, but never wait on them for long.
	await Promise.race([
		Promise.all(['400 200px "Bagel Fat One"', '900 40px Nunito', '800 40px Nunito', '600 40px Nunito'].map((f) => document.fonts.load(f))),
		new Promise((r) => setTimeout(r, 2500)),
	]).catch(() => {});

	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
	const loader = new THREE.TextureLoader();
	const repaints: (() => void)[] = [];
	const themed: (() => void)[] = [];
	const pickables: Pickable[] = [];
	const tickers: ((dt: number, time: number) => void)[] = [];
	const stops: Stop[] = [];
	/** Things that only make sense while Nixchan is the 3D figure. */
	const figureProps: THREE.Object3D[] = [];

	// Light
	const ambient = new THREE.AmbientLight('#ffffff', 1.4);
	const sun = new THREE.DirectionalLight('#ffffff', 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -16;
	sun.shadow.camera.right = 16;
	sun.shadow.camera.top = 12;
	sun.shadow.camera.bottom = -12;
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 60;
	sun.shadow.bias = -0.0005;
	sun.shadow.normalBias = 0.02;
	sun.shadow.radius = 6;
	const lantern = new THREE.PointLight('#ffd38a', 0, 14, 1.4);
	scene.add(ambient, sun, sun.target, lantern);

	// The wall and the floor
	const wallMat = new THREE.MeshLambertMaterial();
	const wall = new THREE.Mesh(new THREE.PlaneGeometry(260, 60), wallMat);
	wall.position.set(STOP_GAP * 2.5, 6, WALL_Z);
	wall.receiveShadow = true;
	const floorMat = new THREE.MeshLambertMaterial();
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 60), floorMat);
	floor.rotation.x = -Math.PI / 2;
	floor.position.set(STOP_GAP * 2.5, FLOOR_Y, WALL_Z + 30);
	floor.receiveShadow = true;
	scene.add(wall, floor);

	// Shared materials that follow the palette
	const plankMat = new THREE.MeshLambertMaterial();
	const surfaceMat = new THREE.MeshLambertMaterial();
	const stringMat = new THREE.MeshBasicMaterial();
	const starMat = new THREE.MeshBasicMaterial({ transparent: true });
	const paperWhite = new THREE.MeshLambertMaterial({ color: '#ffffff' });
	themed.push(() => {
		const night = document.documentElement.dataset.time === 'night';
		scene.background = color('--bg');
		wallMat.color = color('--bg');
		floorMat.color = color('--floor');
		plankMat.color = color('--plank');
		surfaceMat.color = color('--surface');
		stringMat.color = color(night ? '--faint' : '--muted');
		starMat.color = color('--star');
		paperWhite.color.set(night ? '#d9d8f0' : '#ffffff');
		ambient.color.set(night ? '#9a9ef0' : '#ffffff');
		ambient.intensity = night ? 1.3 : 1.75;
		sun.color.set(night ? '#b8c4ff' : '#fff6e8');
		sun.intensity = night ? 0.7 : 1.3;
		lantern.intensity = night ? 18 : 0;
	});

	const plank = (width: number, depth: number, x: number, y: number, thickness = 0.36) => {
		const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, thickness, depth, 2, 0.08), plankMat);
		mesh.position.set(x, y - thickness / 2, WALL_Z + depth / 2);
		mesh.castShadow = mesh.receiveShadow = true;
		scene.add(mesh);
		return mesh;
	};

	const string = (from: THREE.Vector3, to: THREE.Vector3, parent: THREE.Object3D = scene) => {
		const length = from.distanceTo(to);
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, length, 5), stringMat);
		mesh.position.copy(from).add(to).multiplyScalar(0.5);
		mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
		parent.add(mesh);
		return mesh;
	};

	// ---------- stop 0: the wordmark ----------
	{
		const FONT_PX = 256;
		const HEIGHT = 4.2; // world units per font size
		const scale = HEIGHT / FONT_PX;
		const probe = document.createElement('canvas').getContext('2d')!;
		probe.font = `400 ${FONT_PX}px ${DISPLAY}`;
		const chars = ['j', 'i', 'h', 'o', 'o', '.'];
		const metrics = chars.map((c) => probe.measureText(c));
		const pad = 16;
		const ascent = Math.max(...metrics.map((m) => m.actualBoundingBoxAscent));
		const descent = Math.max(...metrics.map((m) => m.actualBoundingBoxDescent));
		const canvasH = Math.ceil(ascent + descent + pad * 2);
		const baseline = pad + ascent;
		const advances = metrics.map((m) => m.width);
		const gap = 0.12;
		const total = advances.reduce((a, b) => a + b * scale + gap, -gap);
		const shelfY = 0;
		plank(total + 3, 1.7, 0, shelfY, 0.5);

		const LAYERS = 12;
		const DEPTH = 0.5;
		const front = WALL_Z + 1.7 + 0.25;
		let x = -total / 2;
		const perch = new THREE.Vector3();
		chars.forEach((char, i) => {
			const m = metrics[i];
			const w = Math.ceil(m.width + pad * 2);
			const canvasEl = document.createElement('canvas');
			canvasEl.width = w;
			canvasEl.height = canvasH;
			const ctx = canvasEl.getContext('2d')!;
			ctx.font = probe.font;
			ctx.fillStyle = '#fff';
			ctx.fillText(char, pad, baseline);
			const map = new THREE.CanvasTexture(canvasEl);
			map.colorSpace = THREE.SRGBColorSpace;
			const geo = new THREE.PlaneGeometry(w * scale, canvasH * scale);
			const isDot = char === '.';
			const faceMat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
			const sideMat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
			themed.push(() => {
				faceMat.color = color(isDot ? '--star' : '--letter');
				sideMat.color = isDot ? color('--star').multiplyScalar(0.78) : color('--letter-side');
			});
			const letter = new THREE.Group();
			for (let l = 0; l < LAYERS; l++) {
				const layer = new THREE.Mesh(geo, l === LAYERS - 1 ? faceMat : sideMat);
				layer.position.z = -DEPTH + (l / (LAYERS - 1)) * DEPTH;
				layer.castShadow = l === 0 || l === LAYERS - 1;
				layer.receiveShadow = l === LAYERS - 1;
				letter.add(layer);
			}
			const cx = x + (w * scale) / 2 - pad * scale;
			// Plane centre sits so the baseline lands on the shelf.
			const cy = shelfY + (canvasH / 2 - baseline) * -scale;
			letter.position.set(cx, cy, front);
			scene.add(letter);
			const top = shelfY + m.actualBoundingBoxAscent * scale;
			if (char === 'o') perch.set(cx + 0.1, top, front + 0.05);

			const bounce = new Spring(140, 9);
			let tilt = 0;
			tickers.push((dt) => {
				letter.position.y = cy + bounce.step(dt);
				tilt = damp(tilt, 0, 8, dt);
				letter.rotation.z = tilt;
			});
			pickables.push({
				object: letter,
				label: isDot ? 'Switch day and night' : '',
				onHover: () => {
					bounce.velocity += 3.2;
				},
				onClick: () => {
					bounce.velocity += 6;
					tilt = (Math.random() - 0.5) * 0.4;
					if (isDot) document.querySelector<HTMLButtonElement>('[data-clock]')?.click();
				},
			});
			x += advances[i] * scale + gap;
		});

		stops.push({ center: new THREE.Vector3(0, 1.6, WALL_Z + 1), width: total + 2, height: 9, perch, swing: -3 });
	}

	// ---------- stop 1: a print on the wall ----------
	{
		const cx = STOP_GAP;
		const size = 5.4;
		const frame = new THREE.Group();
		const border = new THREE.Mesh(new RoundedBoxGeometry(size, size, 0.12, 2, 0.04), paperWhite);
		border.castShadow = true;
		const picture = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.5, size - 0.5), new THREE.MeshLambertMaterial({ map: loadTexture(loader, data.art.thinking) }));
		picture.position.z = 0.065;
		const tape = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), starMat);
		starMat.opacity = 0.8;
		tape.position.set(0, size / 2, 0.08);
		tape.rotation.z = -0.05;
		frame.add(border, picture, tape);
		frame.position.set(cx, 1.6, WALL_Z + 0.08);
		frame.rotation.z = 0.028;
		scene.add(frame);
		const wobble = new Spring(30, 3);
		tickers.push((dt) => {
			frame.rotation.z = 0.028 + wobble.step(dt);
		});
		pickables.push({ object: frame, label: 'Get to know me', href: '/about/', onHover: () => (wobble.velocity += 0.25) });

		// The frame's top edge is too thin for the 3D figure, so she gets a little shelf above it.
		const shelfY = 1.6 + size / 2 + 0.4;
		figureProps.push(plank(2.6, 1.05, cx + 1.3, shelfY, 0.28));
		stops.push({
			center: new THREE.Vector3(cx, 2.1, WALL_Z),
			width: 8,
			height: 10,
			perch: new THREE.Vector3(cx + 1.3, 1.6 + size / 2 + 0.03, WALL_Z + 0.3),
			perch3d: new THREE.Vector3(cx + 1.3, shelfY, WALL_Z + 1.05),
			swing: 2.5,
		});
	}

	// ---------- stop 2: project towers ----------
	{
		const cx = STOP_GAP * 2;
		const projects = data.projects.length
			? [...data.projects].sort((a, b) => a.commits - b.commits)
			: [{ title: 'Projects', tagline: 'Everything I am building lives on the projects page.', language: '', commits: 0, href: '/projects/' }];
		const roots = projects.map((p) => Math.sqrt(p.commits));
		const low = Math.min(...roots);
		const span = Math.max(...roots) - low;
		const W = 3.3;
		const D = 1.5;
		const GAP = 0.45;
		const BASE_H = 3.4;
		const MAX_RISE = 3.2;
		const groundY = -2.2;
		const rowW = projects.length * W + (projects.length - 1) * GAP;
		plank(rowW + 1.6, D + 0.9, cx, groundY, 0.45);
		let perch = new THREE.Vector3(cx, groundY + BASE_H, 0);
		projects.forEach((p, i) => {
			const rise = span > 0 ? ((roots[i] - low) / span) * MAX_RISE : 0;
			const h = BASE_H + rise;
			const tower = new THREE.Group();
			const body = new THREE.Mesh(new RoundedBoxGeometry(W, h, D, 3, 0.16), surfaceMat);
			body.position.y = h / 2;
			body.castShadow = body.receiveShadow = true;
			const LABEL_H = 3.0;
			const { texture, repaint } = paintedTexture(640, Math.round((640 * LABEL_H) / W), (ctx) => {
				const cw = ctx.canvas.width;
				const pad = 44;
				let y = 70;
				ctx.textBaseline = 'alphabetic';
				if (p.language) {
					ctx.fillStyle = LANGUAGE_COLORS[p.language] ?? css('--faint');
					ctx.beginPath();
					ctx.arc(pad + 10, y - 12, 11, 0, Math.PI * 2);
					ctx.fill();
					ctx.fillStyle = css('--muted');
					ctx.font = `800 30px ${SANS}`;
					ctx.fillText(p.language, pad + 32, y);
				}
				// The badge sits right after the language, leaving the right corner for Nixchan.
				if (p.commits > 0) {
					ctx.font = `800 30px ${SANS}`;
					const left = p.language ? pad + 32 + ctx.measureText(p.language).width + 22 : pad;
					ctx.font = `800 26px ${SANS}`;
					const label = `${p.commits} commits · 30d`;
					const lw = ctx.measureText(label).width + 28;
					ctx.fillStyle = css('--accent-soft');
					roundRect(ctx, left, y - 34, lw, 46, 23);
					ctx.fill();
					ctx.fillStyle = css('--accent');
					ctx.fillText(label, left + 14, y);
				}
				y += 92;
				ctx.fillStyle = css('--ink');
				ctx.font = `400 62px ${DISPLAY}`;
				for (const line of wrap(ctx, p.title, cw - pad * 2, 2)) {
					ctx.fillText(line, pad, y);
					y += 70;
				}
				y += 6;
				ctx.fillStyle = css('--muted');
				ctx.font = `600 31px ${SANS}`;
				for (const line of wrap(ctx, p.tagline, cw - pad * 2, 6)) {
					ctx.fillText(line, pad, y);
					y += 42;
				}
			});
			repaints.push(repaint);
			const label = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, LABEL_H), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
			label.position.set(0, h - LABEL_H / 2 - 0.12, D / 2 + 0.005);
			tower.add(body, label);
			const x = cx - rowW / 2 + W / 2 + i * (W + GAP);
			const z = WALL_Z + 0.45 + D / 2;
			tower.position.set(x, groundY, z);
			scene.add(tower);
			if (i === projects.length - 1) perch = new THREE.Vector3(x + 0.5, groundY + h, z + D / 2 + 0.05);
			let hovered = 0;
			let lift = 0;
			tickers.push((dt) => {
				hovered = Math.max(0, hovered - dt);
				lift = damp(lift, hovered > 0 ? 0.28 : 0, 10, dt);
				tower.position.y = groundY + lift;
			});
			pickables.push({ object: tower, label: `${p.title} on GitHub ↗`, href: p.href, external: p.href.startsWith('http'), onHover: () => (hovered = 0.12) });
		});

		stops.push({ center: new THREE.Vector3(cx, groundY + (BASE_H + MAX_RISE) / 2, WALL_Z + 1), width: rowW + 1, height: BASE_H + MAX_RISE + 1.5, perch, swing: -3 });
	}

	// ---------- stop 3: notes hung from a plank ----------
	{
		const cx = STOP_GAP * 3;
		const SW = 3.5;
		const SH = 4.1;
		const GAP = 0.6;
		const plankY = 4.4;
		const drops = [0.55, 1.6, 0.95];
		const posts = data.posts.length ? data.posts : [{ title: 'The journal', description: 'Notes from building things.', date: '', href: '/blog/' }];
		const rowW = posts.length * SW + (posts.length - 1) * GAP;
		plank(rowW + 1.4, 1.2, cx, plankY + 0.36, 0.36);
		posts.forEach((post, i) => {
			const drop = drops[i % drops.length];
			const x = cx - rowW / 2 + SW / 2 + i * (SW + GAP);
			const pivot = new THREE.Group();
			pivot.position.set(x, plankY, WALL_Z + 0.75);
			const { texture, repaint } = paintedTexture(600, Math.round((600 * SH) / SW), (ctx) => {
				const cw = ctx.canvas.width;
				const ch = ctx.canvas.height;
				const pad = 40;
				ctx.fillStyle = css('--surface');
				roundRect(ctx, 0, 0, cw, ch, 18);
				ctx.fill();
				let y = 66;
				ctx.fillStyle = css('--accent');
				ctx.font = `800 26px ${SANS}`;
				ctx.fillText(post.date, pad, y);
				y += 64;
				ctx.fillStyle = css('--ink');
				ctx.font = `900 44px ${SANS}`;
				for (const line of wrap(ctx, post.title, cw - pad * 2, 3)) {
					ctx.fillText(line, pad, y);
					y += 52;
				}
				y += 14;
				ctx.fillStyle = css('--muted');
				ctx.font = `600 29px ${SANS}`;
				for (const line of wrap(ctx, post.description, cw - pad * 2, 7)) {
					ctx.fillText(line, pad, y);
					y += 41;
				}
			});
			repaints.push(repaint);
			const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }));
			sheet.position.y = -drop - SH / 2;
			sheet.castShadow = true;
			pivot.add(sheet);
			for (const side of [-1, 1]) {
				string(new THREE.Vector3(side * SW * 0.32, 0, 0), new THREE.Vector3(side * SW * 0.32, -drop - 0.05, 0), pivot);
			}
			scene.add(pivot);
			const swing = new Spring(9, 1.3);
			const sway = new Spring(6, 1.6);
			const phase = i * 1.7;
			tickers.push((dt, time) => {
				const wind = reduceMotion ? 0 : Math.sin(time * 0.7 + phase) * 0.012;
				pivot.rotation.z = swing.step(dt) + wind;
				pivot.rotation.x = sway.step(dt) + wind * 0.8;
			});
			pickables.push({
				object: sheet,
				label: post.title,
				href: post.href,
				onHover: () => {
					swing.velocity += 0.35;
					sway.velocity -= 0.25;
				},
			});
		});

		stops.push({ center: new THREE.Vector3(cx, plankY - 3, WALL_Z + 1), width: rowW + 1, height: 9, perch: new THREE.Vector3(cx + rowW / 2 - 0.5, plankY + 0.36, WALL_Z + 1.25), swing: 3 });
	}

	// ---------- stop 4: comics on nails ----------
	{
		const cx = STOP_GAP * 4;
		const S = 3.6;
		const GAP = 0.9;
		const nailY = 4.3;
		const comics = data.comics;
		const rowW = comics.length * S + (comics.length - 1) * GAP;
		const tilts = [-0.035, 0.025, -0.015];
		const hangs = [1.1, 0.7, 1.4];
		comics.forEach((comic, i) => {
			const x = cx - rowW / 2 + S / 2 + i * (S + GAP);
			const nail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), plankMat);
			nail.position.set(x, nailY, WALL_Z + 0.06);
			scene.add(nail);
			const pivot = new THREE.Group();
			pivot.position.set(x, nailY, WALL_Z + 0.12);
			const frame = new THREE.Group();
			const border = new THREE.Mesh(new RoundedBoxGeometry(S, S, 0.14, 2, 0.05), paperWhite);
			border.castShadow = true;
			const texture = loader.load(comic.image, coverSquare);
			texture.colorSpace = THREE.SRGBColorSpace;
			const picture = new THREE.Mesh(new THREE.PlaneGeometry(S - 0.4, S - 0.4), new THREE.MeshLambertMaterial({ map: texture }));
			picture.position.z = 0.075;
			frame.add(border, picture);
			frame.position.y = -hangs[i % hangs.length] - S / 2;
			pivot.add(frame);
			const top = -hangs[i % hangs.length];
			for (const side of [-1, 1]) string(new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * S * 0.38, top, 0), pivot);
			pivot.rotation.z = tilts[i % tilts.length];
			scene.add(pivot);
			const swing = new Spring(14, 2);
			tickers.push((dt) => {
				pivot.rotation.z = tilts[i % tilts.length] + swing.step(dt);
			});
			pickables.push({ object: frame, label: comic.title, href: comic.href, onHover: () => (swing.velocity += 0.3) });
		});
		// She waits on a little shelf below the comics.
		const shelfY = -2;
		plank(rowW * 0.6, 1.1, cx, shelfY, 0.32);

		stops.push({ center: new THREE.Vector3(cx, 0.6, WALL_Z + 1), width: Math.max(rowW, 4) + 1, height: 9, perch: new THREE.Vector3(cx - 0.4, shelfY, WALL_Z + 1.15), swing: -2.5 });
	}

	// ---------- stop 5: the end, by the floor ----------
	{
		const cx = STOP_GAP * 5;
		const size = 3.4;
		const frame = new THREE.Group();
		const border = new THREE.Mesh(new RoundedBoxGeometry(size, size, 0.12, 2, 0.04), paperWhite);
		border.castShadow = true;
		const picture = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.36, size - 0.36), new THREE.MeshLambertMaterial({ map: loadTexture(loader, data.art.nap) }));
		picture.position.z = 0.065;
		frame.add(border, picture);
		frame.position.set(cx - 1.6, 1.4, WALL_Z + 0.08);
		frame.rotation.z = -0.04;
		scene.add(frame);
		const shelfY = -1.2;
		plank(7, 1.1, cx + 0.4, shelfY, 0.36);
		pickables.push({ object: frame, label: 'Back to the 2D site', href: '/' });
		stops.push({ center: new THREE.Vector3(cx, -0.6, WALL_Z + 1), width: 8, height: 8.5, perch: new THREE.Vector3(cx + 2.2, shelfY, WALL_Z + 1.15), swing: 2 });
	}

	// ---------- stars painted on the wall, out at night ----------
	{
		const rand = (() => {
			let s = 12;
			return () => ((s = (s * 16807) % 2147483647) / 2147483647);
		})();
		const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true });
		const sparkMat = new THREE.MeshBasicMaterial({ transparent: true });
		const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.05, 8), dotMat, 320);
		const star = new THREE.Shape();
		star.moveTo(0, 1);
		star.quadraticCurveTo(0, 0, 1, 0);
		star.quadraticCurveTo(0, 0, 0, -1);
		star.quadraticCurveTo(0, 0, -1, 0);
		star.quadraticCurveTo(0, 0, 0, 1);
		const sparks = new THREE.InstancedMesh(new THREE.ShapeGeometry(star, 4), sparkMat, 40);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		for (let i = 0; i < dots.count; i++) {
			const s = 0.5 + rand() * 1.4;
			m.compose(new THREE.Vector3(-20 + rand() * (STOP_GAP * 5 + 40), FLOOR_Y + 1 + rand() * 18, WALL_Z + 0.01), q, new THREE.Vector3(s, s, 1));
			dots.setMatrixAt(i, m);
		}
		for (let i = 0; i < sparks.count; i++) {
			const s = 0.12 + rand() * 0.16;
			m.compose(new THREE.Vector3(-20 + rand() * (STOP_GAP * 5 + 40), FLOOR_Y + 2 + rand() * 17, WALL_Z + 0.015), q, new THREE.Vector3(s, s, 1));
			sparks.setMatrixAt(i, m);
		}
		scene.add(dots, sparks);
		themed.push(() => {
			const night = document.documentElement.dataset.time === 'night';
			dots.visible = sparks.visible = night;
			sparkMat.color = color('--star');
		});
		tickers.push((_dt, time) => {
			const t = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(time * 1.3);
			dotMat.opacity = 0.35 + 0.5 * t;
			sparkMat.opacity = 0.5 + 0.5 * (reduceMotion ? 1 : Math.sin(time * 0.9 + 1) * 0.5 + 0.5);
		});
	}

	// ---------- Nixchan ----------
	const nixMode = document.querySelector<HTMLButtonElement>('[data-nix-mode]');
	// Two of her share one rig: the flat layered sprite, and a 3D figure. A button in the bar picks one.
	const nix = (() => {
		const H = 2.7;
		const W = (H * 525) / 890;
		const seat = { x: 0.381, y: 0.747 };
		const plane = (url: string, pivot: { x: number; y: number }, order: number) => {
			const geo = new THREE.PlaneGeometry(W, H);
			geo.translate((0.5 - pivot.x) * W, (pivot.y - 0.5) * H, 0);
			const mat = new THREE.MeshLambertMaterial({ map: loadTexture(loader, url), transparent: true, alphaTest: 0.02, depthWrite: false });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.renderOrder = order;
			return mesh;
		};
		const root = new THREE.Group();
		const squash = new THREE.Group();
		const flat = new THREE.Group();
		root.add(squash);
		squash.add(flat);
		const legPivot = (p: { x: number; y: number }) => new THREE.Vector3((p.x - seat.x) * W, (seat.y - p.y) * H, -0.01);
		const legs = [
			{ x: 0.286, y: 0.713 },
			{ x: 0.467, y: 0.713 },
		].map((p, i) => {
			const g = new THREE.Group();
			g.position.copy(legPivot(p));
			g.add(plane(i === 0 ? data.art.nix.legL : data.art.nix.legR, p, 10));
			flat.add(g);
			return g;
		});
		const body = plane(data.art.nix.body, seat, 11);
		const blink = plane(data.art.nix.blink, seat, 12);
		blink.position.z = 0.01;
		blink.visible = false;
		flat.add(body, blink);
		// A shadow-only stand-in, since the transparent sprite itself can't cast a proper one.
		const shadowCaster = new THREE.Mesh(new THREE.CircleGeometry(W * 0.36, 16), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
		shadowCaster.position.set(0.05, H * 0.28, -0.05);
		shadowCaster.scale.y = 1.35;
		shadowCaster.castShadow = true;
		flat.add(shadowCaster);
		const figure = buildNixFigure(data.art.nix.model);
		squash.add(figure.group);
		scene.add(root);
		// Without the model there is only the sprite to show.
		let modelFailed = false;
		figure.ready.then(
			() => {
				loaded = true;
				applyMode();
			},
			() => {
			modelFailed = true;
			if (solid) setSolid(false);
				if (nixMode) nixMode.hidden = true;
			},
		);

		let solid = true;
		try {
			solid = localStorage.getItem('nix-mode') !== '2d';
		} catch {
			// Default to the figure.
		}
		const perchOf = (index: number) => (solid && stops[index].perch3d) || stops[index].perch;
		let loaded = false;
		const applyMode = () => {
			// Until the model has loaded she stays a sprite, so she never vanishes.
			flat.visible = !(solid && loaded);
			figure.group.visible = solid && loaded;
			figureProps.forEach((o) => (o.visible = solid));
		};
		applyMode();

		const from = new THREE.Vector3();
		const to = perchOf(0).clone();
		function setSolid(value: boolean) {
			solid = value && !modelFailed;
			applyMode();
			to.copy(perchOf(stop));
			if (jump === 1) root.position.copy(to);
			hop = 1;
			squashSpring.velocity -= 5;
		}
		root.position.copy(to);
		let stop = 0;
		let jump = 1; // 0 → 1 while airborne
		let jumpTime = 1;
		let arc = 0;
		let facing = 1;
		let turn = 0;
		let nextBlink = 2;
		let hop = 0;
		const squashSpring = new Spring(160, 10);
		// Clicking the 3D figure has her show off one move after another, then sit back down.
		const tricks = [
			{ clip: 'Wave', time: 3.2 },
			{ clip: 'Hop', time: 0 },
			{ clip: 'Walk', time: 3 },
			{ clip: 'Run', time: 2.4 },
		] as const;
		let nextTrick = 0;
		let trick: (typeof tricks)[number] | null = null;
		let trickLeft = 0;
		// Which way she turns to walk or run: towards the middle of the view, where there is room.
		let trickSide = 1;
		// While she walks or runs side-on she keeps her eyes on the way ahead.
		const zero = new THREE.Vector2();

		return {
			root,
			squash,
			get solid() {
				return solid;
			},
			setSolid,
			goTo(index: number) {
				if (index === stop) return;
				stop = index;
				from.copy(root.position);
				to.copy(perchOf(index));
				const distance = from.distanceTo(to);
				jumpTime = reduceMotion ? 0.01 : 0.6 + Math.min(distance, 60) * 0.012;
				arc = reduceMotion ? 0 : 2 + Math.min(distance, 60) * 0.08;
				jump = 0;
				trick = null;
				facing = to.x < from.x ? -1 : 1;
				flat.scale.x = facing;
				squashSpring.velocity -= 4;
			},
			poke() {
				if (!(solid && loaded) || reduceMotion || jump < 1) {
					hop = 1;
					squashSpring.velocity -= 5;
					return;
				}
				trick = tricks[nextTrick];
				nextTrick = (nextTrick + 1) % tricks.length;
				trickLeft = trick.time;
				trickSide = stops[stop].center.x < root.position.x ? -1 : 1;
				if (trick.clip === 'Hop') {
					hop = 1;
					squashSpring.velocity -= 5;
					trick = null;
				}
			},
			tick(dt: number, time: number, look: THREE.Vector2) {
				if (jump < 1) {
					jump = Math.min(1, jump + dt / jumpTime);
					const t = smooth(jump);
					root.position.lerpVectors(from, to, t);
					root.position.y += Math.sin(Math.PI * jump) * arc;
					root.rotation.z = Math.sin(Math.PI * jump) * -0.25 * facing;
					if (jump === 1) {
						squashSpring.velocity -= 7;
						root.rotation.z = 0;
					}
				} else {
					root.position.copy(to);
				}
				if (hop > 0) {
					hop = Math.max(0, hop - dt * (solid ? 1.7 : 2.4));
					root.position.y += Math.sin(Math.PI * (1 - hop)) * 0.6;
				}
				const s = squashSpring.step(dt);
				squash.scale.set(1 - s * 0.12, 1 + s * 0.18, solid ? 1 - s * 0.12 : 1);
				const airborne = jump < 1 || hop > 0;
				if (solid) {
					if (trick) {
						trickLeft -= dt;
						if (trickLeft <= 0) trick = null;
					}
					const strolling = trick !== null && trick.clip !== 'Wave';
					figure.play(trick ? (trick.clip as NixClip) : 'Sit');
					// The figure turns towards where she is jumping or walking, then back to face the camera.
					const turnTo = jump < 1 && !reduceMotion ? facing * 0.75 : strolling ? trickSide * 1.15 : 0;
					turn = damp(turn, turnTo, 7, dt);
					figure.group.rotation.y = turn;
					const flight = jump < 1 ? jump : hop > 0 ? 1 - hop : null;
					figure.tick(dt, time, { airborne, look: strolling ? zero : look, still: reduceMotion, jump: flight });
				} else {
					legs.forEach((leg, i) => {
						const swingAngle = reduceMotion ? 0 : Math.sin(time * 2.6 + i * Math.PI) * 0.22;
						leg.rotation.z = damp(leg.rotation.z, airborne ? (i === 0 ? 0.5 : 0.35) : swingAngle, 10, dt);
					});
				}
				nextBlink -= dt;
				if (nextBlink < 0) {
					const closed = nextBlink > -0.13;
					blink.visible = closed;
					figure.setBlink(closed);
					if (!closed) nextBlink = 2.5 + Math.random() * 3;
				}
				lantern.position.set(root.position.x + 0.6, root.position.y + 2, root.position.z + 1.5);
			},
		};
	})();
	pickables.push({ object: nix.squash, label: 'Nixchan', onClick: () => nix.poke(), onHover: () => {} });

	if (nixMode) {
		const label = () => {
			nixMode.textContent = nix.solid ? 'Nixchan: 3D' : 'Nixchan: 2D';
			nixMode.setAttribute('aria-pressed', String(nix.solid));
		};
		label();
		nixMode.hidden = false;
		nixMode.addEventListener('click', () => {
			nix.setSolid(!nix.solid);
			label();
			try {
				localStorage.setItem('nix-mode', nix.solid ? '3d' : '2d');
			} catch {
				// The choice just won't be remembered.
			}
		});
	}

	// ---------- camera, scrolling, picking ----------
	const sections = [...document.querySelectorAll<HTMLElement>('[data-stop]')];
	const tip = document.querySelector<HTMLElement>('[data-tip]')!;
	const pointer = new THREE.Vector2(10, 10);
	const parallax = new THREE.Vector2();
	const raycaster = new THREE.Raycaster();
	const camPos = new THREE.Vector3();
	const camLook = new THREE.Vector3();
	const wantPos = new THREE.Vector3();
	const wantLook = new THREE.Vector3();
	let viewShift = { x: 0, y: 0 };
	let width = 0;
	let height = 0;
	let narrow = false;
	let hovered: Pickable | null = null;
	const nixHead = new THREE.Vector3();
	const nixLook = new THREE.Vector2();

	const fitFor = (stop: Stop, index: number) => {
		const aspect = width / height;
		const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
		const hero = index === 0;
		// How much of the screen the 3D content may take next to the text card.
		const fracW = narrow ? 0.92 : hero ? 0.86 : 0.58;
		const fracH = narrow ? (hero ? 0.62 : 0.5) : hero ? 0.72 : 0.86;
		const distance = Math.max(stop.width / (fracW * 2 * tan * aspect), stop.height / (fracH * 2 * tan));
		return { distance, shiftX: narrow || hero ? 0 : -0.19, shiftY: narrow ? (hero ? 0.12 : 0.22) : hero ? 0.1 : 0 };
	};

	const progress = () => {
		const mid = scrollY + innerHeight / 2;
		const centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2);
		if (mid <= centers[0]) return 0;
		for (let i = 0; i < centers.length - 1; i++) {
			if (mid < centers[i + 1]) return i + (mid - centers[i]) / (centers[i + 1] - centers[i]);
		}
		return centers.length - 1;
	};

	const target = (p: number) => {
		const i = Math.min(Math.floor(p), stops.length - 2);
		const f = smooth(THREE.MathUtils.clamp(p - i, 0, 1));
		const a = stops[i];
		const b = stops[i + 1];
		const fa = fitFor(a, i);
		const fb = fitFor(b, i + 1);
		const distance = THREE.MathUtils.lerp(fa.distance, fb.distance, f);
		wantLook.lerpVectors(a.center, b.center, f);
		const swing = THREE.MathUtils.lerp(a.swing, b.swing, f);
		// Step back from the wall mid-walk, so the trip between stops reads as moving through space.
		const back = Math.sin(Math.PI * f) * 5;
		wantPos.set(wantLook.x + swing, wantLook.y + 1.2 + distance * 0.08, wantLook.z + distance + back);
		viewShift = { x: THREE.MathUtils.lerp(fa.shiftX, fb.shiftX, f), y: THREE.MathUtils.lerp(fa.shiftY, fb.shiftY, f) };
	};

	const resize = () => {
		width = innerWidth;
		height = innerHeight;
		narrow = width < 850;
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	};

	const pick = () => {
		raycaster.setFromCamera(pointer, camera);
		const hits = raycaster.intersectObjects(
			pickables.map((p) => p.object),
			true,
		);
		if (!hits.length) return null;
		let obj: THREE.Object3D | null = hits[0].object;
		while (obj) {
			const found = pickables.find((p) => p.object === obj);
			if (found) return found;
			obj = obj.parent;
		}
		return null;
	};

	let downAt: { x: number; y: number } | null = null;
	let lastPointer = { x: 0, y: 0 };
	addEventListener('pointermove', (e) => {
		lastPointer = { x: e.clientX, y: e.clientY };
		pointer.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
		if (e.pointerType === 'mouse') parallax.set(pointer.x, pointer.y);
	});
	addEventListener('pointerleave', () => pointer.set(10, 10));
	canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
	// The overlay sits above the canvas, so clicks are read from the document and ignored on real controls.
	addEventListener('pointerup', (e) => {
		const start = downAt;
		downAt = null;
		if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
		pointer.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);
		const hit = pick();
		if (!hit) return;
		hit.onClick?.();
		if (hit.href) {
			if (hit.external) open(hit.href, '_blank', 'noopener');
			else location.href = hit.href;
		}
	});
	const applyTheme = () => {
		themed.forEach((f) => f());
		repaints.forEach((f) => f());
	};
	addEventListener('site-time', applyTheme);
	addEventListener('resize', resize);
	resize();
	applyTheme();

	target(progress());
	camPos.copy(wantPos);
	camLook.copy(wantLook);

	const clock = new THREE.Clock();
	let current = Math.round(progress());
	renderer.setAnimationLoop(() => {
		const dt = Math.min(clock.getDelta(), 0.05);
		const time = clock.elapsedTime;
		const p = progress();
		target(p);
		const rate = reduceMotion ? 30 : 5;
		const sway = new THREE.Vector3(parallax.x * 0.8, parallax.y * 0.45, 0);
		camPos.x = damp(camPos.x, wantPos.x + sway.x, rate, dt);
		camPos.y = damp(camPos.y, wantPos.y + sway.y, rate, dt);
		camPos.z = damp(camPos.z, wantPos.z, rate, dt);
		camLook.x = damp(camLook.x, wantLook.x, rate, dt);
		camLook.y = damp(camLook.y, wantLook.y, rate, dt);
		camLook.z = damp(camLook.z, wantLook.z, rate, dt);
		camera.position.copy(camPos);
		camera.lookAt(camLook);
		camera.setViewOffset(width, height, viewShift.x * width, viewShift.y * height, width, height);

		sun.target.position.copy(camLook);
		sun.position.copy(camLook).add(new THREE.Vector3(-7, 13, 12));

		const stop = Math.round(p);
		if (stop !== current) {
			current = stop;
			nix.goTo(stop);
		}
		// She looks from where she is on screen towards the pointer.
		if (pointer.x <= 1) {
			nixHead.copy(nix.root.position).y += 1.3;
			nixHead.project(camera);
			nixLook.set((pointer.x - nixHead.x) * 2, (pointer.y - nixHead.y) * 2);
		} else nixLook.set(0, 0);
		nix.tick(dt, time, nixLook);
		tickers.forEach((f) => f(dt, time));

		const hit = pointer.x <= 1 ? pick() : null;
		if (hit !== hovered) {
			hovered = hit;
			hit?.onHover?.();
			canvas.style.cursor = document.body.style.cursor = hit ? 'pointer' : '';
			tip.hidden = !hit?.label;
			if (hit) tip.textContent = hit.label;
		}
		if (hit) tip.style.transform = `translate(${lastPointer.x + 14}px, ${lastPointer.y + 16}px)`;

		renderer.render(scene, camera);
	});
}
