// The experimental 3D homepage: a winding path that leads into the screen as the page scrolls.
// Each stop is a little station by the side of the path, a freestanding wall with things standing on
// planks or hanging from strings like the 2D site. Stations further down the path fade into the haze.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildNixFigure, type NixClip, type NixJump } from './nix-figure';

interface SceneData {
	projects: { title: string; tagline: string; language: string; commits: number; href: string }[];
	posts: { title: string; description: string; date: string; href: string }[];
	comics: { title: string; href: string; image: string }[];
	art: { thinking: string; nap: string; nix: { body: string; legL: string; legR: string; blink: string; model: string } };
}

/** Where the camera looks at each stop, and how much of the station it needs to fit. */
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

/** The back of each station, in its own frame; everything on it stands in front. */
const WALL_Z = -2;
const FLOOR_Y = -3.2;
/** How far down the path each station is from the last. */
const STOP_GAP = 22;
/** How far a station stands from the middle of the path, past its own half-width. */
const ROADSIDE = 2.6;
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

	// The ground, running off into the haze. Each station brings its own wall.
	const fog = new THREE.Fog('#ffffff', 30, 78);
	scene.fog = fog;
	const wallMat = new THREE.MeshLambertMaterial();
	const floorMat = new THREE.MeshLambertMaterial();
	const pathMat = new THREE.MeshLambertMaterial();
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, STOP_GAP * 5 + 160), floorMat);
	floor.rotation.x = -Math.PI / 2;
	floor.position.set(0, FLOOR_Y, -STOP_GAP * 2.5);
	floor.receiveShadow = true;
	scene.add(floor);

	// Shared materials that follow the palette
	const plankMat = new THREE.MeshLambertMaterial();
	const surfaceMat = new THREE.MeshLambertMaterial();
	const stringMat = new THREE.MeshBasicMaterial();
	const starMat = new THREE.MeshBasicMaterial({ transparent: true });
	const paperWhite = new THREE.MeshLambertMaterial({ color: '#ffffff' });
	themed.push(() => {
		const night = document.documentElement.dataset.time === 'night';
		scene.background = color('--bg');
		fog.color = color('--bg');
		// A shade off the sky, so a station's wall reads as a thing standing in it.
		wallMat.color = color('--bg').lerp(color('--plank'), night ? 0.16 : 0.08);
		// By day a pale meadow with a paler path through it; by night the path glows faintly in the dark.
		floorMat.color = night ? color('--floor') : color('--bg').lerp(color('--plank'), 0.3);
		pathMat.color = night ? color('--floor').lerp(color('--surface'), 0.5) : color('--surface').lerp(color('--bg'), 0.35);
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

	// Each stop is built around its own origin in a group of its own, and placed by the path later.
	const stations: THREE.Group[] = [];
	let into = new THREE.Group();
	const station = () => {
		into = new THREE.Group();
		stations.push(into);
		scene.add(into);
		return into;
	};

	const plank = (width: number, depth: number, x: number, y: number, thickness = 0.36) => {
		const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, thickness, depth, 2, 0.08), plankMat);
		mesh.position.set(x, y - thickness / 2, WALL_Z + depth / 2);
		mesh.castShadow = mesh.receiveShadow = true;
		into.add(mesh);
		return mesh;
	};

	const string = (from: THREE.Vector3, to: THREE.Vector3, parent: THREE.Object3D = into) => {
		const length = from.distanceTo(to);
		const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, length, 5), stringMat);
		mesh.position.copy(from).add(to).multiplyScalar(0.5);
		mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
		parent.add(mesh);
		return mesh;
	};

	// ---------- stop 0: the wordmark ----------
	{
		station();
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
			into.add(letter);
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
		station();
		const cx = 0;
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
		into.add(frame);
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
		station();
		const cx = 0;
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
			into.add(tower);
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
		station();
		const cx = 0;
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
			into.add(pivot);
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
		station();
		const cx = 0;
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
			into.add(nail);
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
			into.add(pivot);
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
		station();
		const cx = 0;
		const size = 3.4;
		const frame = new THREE.Group();
		const border = new THREE.Mesh(new RoundedBoxGeometry(size, size, 0.12, 2, 0.04), paperWhite);
		border.castShadow = true;
		const picture = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.36, size - 0.36), new THREE.MeshLambertMaterial({ map: loadTexture(loader, data.art.nap) }));
		picture.position.z = 0.065;
		frame.add(border, picture);
		frame.position.set(cx - 1.6, 1.4, WALL_Z + 0.08);
		frame.rotation.z = -0.04;
		into.add(frame);
		const shelfY = -1.2;
		plank(7, 1.1, cx + 0.4, shelfY, 0.36);
		pickables.push({ object: frame, label: 'Back to the 2D site', href: '/' });
		stops.push({ center: new THREE.Vector3(cx, -0.6, WALL_Z + 1), width: 8, height: 8.5, perch: new THREE.Vector3(cx + 2.2, shelfY, WALL_Z + 1.15), swing: 2 });
	}

	// ---------- the path, and the stations along it ----------
	// The path wanders gently into the screen. Stations stand on alternate sides of it, the first one
	// at its head, and the camera walks down it from one to the next.
	const pathX = (z: number) => 1.4 * Math.sin(z * 0.11);
	const sides = stops.map((_, i) => (i === 0 ? 0 : i % 2 ? 1 : -1));
	/** The stations' walls, which the camera keeps to its own side of while you walk about. */
	const walls: THREE.Mesh[] = [];
	/** Where on the path Nixchan stands to hop up to each stop's perch. */
	const anchors: THREE.Vector3[] = [];
	stops.forEach((stop, i) => {
		const group = stations[i];
		const side = sides[i];
		const z = -i * STOP_GAP;
		const origin = new THREE.Vector3(side === 0 ? 0 : pathX(z) + side * (stop.width / 2 + ROADSIDE), 0, z);
		group.position.copy(origin);
		// A freestanding wall behind each station, standing on the ground. The wordmark has a plinth
		// under its plank instead, so its letters stand against the sky at the head of the path.
		const top = i === 0 ? -0.5 : stop.center.y + stop.height / 2 - 1.2;
		const depth = i === 0 ? 1.5 : 0.4;
		const panel = new THREE.Mesh(new RoundedBoxGeometry(stop.width + 1.2, top - FLOOR_Y, depth, 3, 0.16), wallMat);
		walls.push(panel);
		panel.position.set(stop.center.x, (top + FLOOR_Y) / 2, i === 0 ? WALL_Z + 0.85 : WALL_Z - 0.2);
		panel.castShadow = panel.receiveShadow = true;
		group.add(panel);
		stop.center.add(origin);
		stop.perch.add(origin);
		stop.perch3d?.add(origin);
		// The camera stands out over the path, so the way on stays in view.
		if (side !== 0) stop.swing = -side * 3.2;
		anchors.push(
			side === 0
				? new THREE.Vector3(stop.perch.x, FLOOR_Y, z + 3.2)
				: new THREE.Vector3(pathX(z) + side * 0.9, FLOOR_Y, z + 1.6),
		);
	});

	const pathPoints: THREE.Vector3[] = [new THREE.Vector3(anchors[0].x, FLOOR_Y, anchors[0].z + 7)];
	const anchorIndex: number[] = [];
	anchors.forEach((anchor, i) => {
		anchorIndex.push(pathPoints.length);
		pathPoints.push(anchor);
		if (i === anchors.length - 1) return;
		// Round the far side of the wordmark, then back to the middle of the path between stations.
		if (i === 0) pathPoints.push(new THREE.Vector3(stops[0].width / 2 + 4, FLOOR_Y, -1));
		const zm = -(i + 0.5) * STOP_GAP;
		pathPoints.push(new THREE.Vector3(pathX(zm), FLOOR_Y, zm));
	});
	const lastZ = -(stops.length - 1) * STOP_GAP;
	pathPoints.push(new THREE.Vector3(pathX(lastZ - 16), FLOOR_Y, lastZ - 16));
	const path = new THREE.CatmullRomCurve3(pathPoints, false, 'centripetal');
	const anchorT = anchorIndex.map((j) => j / (pathPoints.length - 1));
	/** The path's parameter at `s`, counted in stops: s = 2 is the anchor of stop 2. */
	const pathT = (s: number) => {
		const k = THREE.MathUtils.clamp(Math.floor(s), 0, anchorT.length - 2);
		return THREE.MathUtils.lerp(anchorT[k], anchorT[k + 1], THREE.MathUtils.clamp(s - k, 0, 1));
	};
	/** Where the lamp posts stand, for walking round them. */
	const posts: THREE.Vector3[] = [];
	/** The point on the path `s` stops along it. */
	const pathAt = (s: number, out = new THREE.Vector3()) => path.getPoint(pathT(s), out);
	/** How far it is along the path from each stop's anchor to the next. */
	const legLength = anchorT.slice(1).map((t1, k) => {
		let length = 0;
		const prev = path.getPoint(anchorT[k]);
		const next = new THREE.Vector3();
		for (let n = 1; n <= 60; n++) {
			path.getPoint(THREE.MathUtils.lerp(anchorT[k], t1, n / 60), next);
			length += next.distanceTo(prev);
			prev.copy(next);
		}
		return length;
	});

	// The path itself: a flat ribbon laid on the ground.
	{
		const N = 480;
		const PATH_W = 2.8;
		const positions: number[] = [];
		const index: number[] = [];
		const p = new THREE.Vector3();
		const tangent = new THREE.Vector3();
		const across = new THREE.Vector3();
		for (let n = 0; n <= N; n++) {
			const t = n / N;
			path.getPoint(t, p);
			path.getTangent(t, tangent);
			across.set(-tangent.z, 0, tangent.x).normalize().multiplyScalar(PATH_W / 2);
			// Rounded off at either end.
			const taper = Math.min(1, Math.sqrt(Math.min(t, 1 - t) * 60));
			positions.push(p.x - across.x * taper, FLOOR_Y + 0.02, p.z - across.z * taper, p.x + across.x * taper, FLOOR_Y + 0.02, p.z + across.z * taper);
			// Wound so the faces look up.
			if (n < N) index.push(n * 2, n * 2 + 1, n * 2 + 2, n * 2 + 1, n * 2 + 3, n * 2 + 2);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geo.setIndex(index);
		geo.computeVertexNormals();
		const ribbon = new THREE.Mesh(geo, pathMat);
		ribbon.receiveShadow = true;
		scene.add(ribbon);

		// Little lamps along the way, lit at night; going past them is what makes the walk feel like one.
		const lampMat = new THREE.MeshBasicMaterial();
		const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6);
		const bulbGeo = new THREE.SphereGeometry(0.17, 12, 8);
		const total = path.getLength();
		let flip = 1;
		posts.length = 0;
		for (let d = 4; d < total - 3; d += 6.5) {
			const t = d / total;
			path.getPointAt(t, p);
			path.getTangentAt(t, tangent);
			across.set(-tangent.z, 0, tangent.x).normalize();
			flip = -flip;
			const at = p.clone().addScaledVector(across, flip * 2.1);
			// Not in the way of a station, or of where she hops up to one.
			if (anchors.some((a) => a.distanceTo(at) < 3.6)) continue;
			if (stations.some((g, i) => Math.abs(at.z - g.position.z) < 3 && Math.abs(at.x - g.position.x) < stops[i].width / 2 + 1)) continue;
			posts.push(at.clone());
			const post = new THREE.Mesh(postGeo, plankMat);
			post.position.set(at.x, FLOOR_Y + 0.75, at.z);
			post.castShadow = true;
			const bulb = new THREE.Mesh(bulbGeo, lampMat);
			bulb.position.set(at.x, FLOOR_Y + 1.6, at.z);
			scene.add(post, bulb);
		}
		themed.push(() => {
			const night = document.documentElement.dataset.time === 'night';
			lampMat.color = night ? color('--star') : color('--surface');
		});
	}

	// ---------- walking about: what's in the way, and which station is close ----------
	// Each station's footprint on the ground; she walks round it, not through it.
	const footprints = stations.map((group) => {
		group.updateMatrixWorld(true);
		return new THREE.Box3().setFromObject(group);
	});
	const BODY_R = 0.45;
	const collide = (p: THREE.Vector3) => {
		for (const box of footprints) {
			const dx0 = p.x - (box.min.x - BODY_R);
			const dx1 = box.max.x + BODY_R - p.x;
			const dz0 = p.z - (box.min.z - BODY_R);
			const dz1 = box.max.z + BODY_R - p.z;
			if (dx0 <= 0 || dx1 <= 0 || dz0 <= 0 || dz1 <= 0) continue;
			// Out by the shortest way.
			const least = Math.min(dx0, dx1, dz0, dz1);
			if (least === dx0) p.x -= dx0;
			else if (least === dx1) p.x += dx1;
			else if (least === dz0) p.z -= dz0;
			else p.z += dz1;
		}
		for (const post of posts) {
			const dx = p.x - post.x;
			const dz = p.z - post.z;
			const d = Math.hypot(dx, dz);
			const min = BODY_R + 0.12;
			if (d < min && d > 1e-5) {
				p.x = post.x + (dx / d) * min;
				p.z = post.z + (dz / d) * min;
			}
		}
		// The edge of the world: the meadow goes on, but she stays near the path.
		p.x = THREE.MathUtils.clamp(p.x, -40, 40);
		p.z = THREE.MathUtils.clamp(p.z, lastZ - 22, 14);
	};
	/** The station whose footprint is within `reach` of `p`, nearest first, or -1. */
	const stationNear = (p: THREE.Vector3, reach = 3.5) => {
		let best = -1;
		let bestD = reach;
		footprints.forEach((box, i) => {
			const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
			const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
			// Standing where she'd hop up from counts as being by it too.
			const d = Math.min(Math.hypot(dx, dz), Math.hypot(p.x - anchors[i].x, p.z - anchors[i].z));
			if (d < bestD || (reach === Infinity && best < 0)) {
				best = i;
				bestD = d;
			}
		});
		return best;
	};

	// ---------- stars, out at night ----------
	// Pinned to the sky: the dome travels with the camera, so they never come any closer.
	const sky = new THREE.Group();
	{
		const rand = (() => {
			let s = 12;
			return () => ((s = (s * 16807) % 2147483647) / 2147483647);
		})();
		const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, fog: false, depthWrite: false });
		const sparkMat = new THREE.MeshBasicMaterial({ transparent: true, fog: false, depthWrite: false });
		const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 8), dotMat, 360);
		const star = new THREE.Shape();
		star.moveTo(0, 1);
		star.quadraticCurveTo(0, 0, 1, 0);
		star.quadraticCurveTo(0, 0, 0, -1);
		star.quadraticCurveTo(0, 0, -1, 0);
		star.quadraticCurveTo(0, 0, 0, 1);
		const sparks = new THREE.InstancedMesh(new THREE.ShapeGeometry(star, 4), sparkMat, 40);
		const place = new THREE.Object3D();
		const scatter = (mesh: THREE.InstancedMesh, size: () => number) => {
			for (let i = 0; i < mesh.count; i++) {
				// Mostly ahead and above, where the camera looks.
				place.position.set((rand() - 0.5) * 2.4, 0.04 + rand() * 0.9, -0.25 - rand()).normalize().multiplyScalar(120);
				place.lookAt(0, 0, 0);
				const s = size();
				place.scale.set(s, s, 1);
				place.updateMatrix();
				mesh.setMatrixAt(i, place.matrix);
			}
			mesh.renderOrder = -1;
			mesh.frustumCulled = false;
		};
		scatter(dots, () => 0.6 + rand() * 1.4);
		scatter(sparks, () => 0.4 + rand() * 0.5);
		sky.add(dots, sparks);
		scene.add(sky);
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
		// In 3D she gets about on foot: down from her perch, along the path, up onto the next one.
		// The flat sprite can't walk, so it leaps straight from perch to perch.
		const walks = () => solid && loaded && !reduceMotion;
		function setSolid(value: boolean) {
			solid = value && !modelFailed;
			applyMode();
			// Wherever she was on the path, she starts over sitting on the perch in view.
			onPath = false;
			free = false;
			stop = Math.round(scroll);
			to.copy(perchOf(stop));
			if (jump === 1) root.position.copy(to);
			hop = 1;
			squashSpring.velocity -= 5;
		}
		root.position.copy(to);
		let stop = 0;
		let scroll = 0;
		let onPath = false;
		let s = 0; // where she is along the path, counted in stops
		let jump = 1; // 0 → 1 while airborne
		let jumpTime = 1;
		let arc = 0;
		/** Where a leap puts her: on the path to stroll, on a perch to sit, or on the ground to be steered. */
		let landing: 'path' | 'perch' | 'free' = 'perch';
		// Walking about freely: she is steered with the keys rather than following the scroll.
		let roam = false;
		let free = false;
		const steer = new THREE.Vector3();
		let running = false;
		const vel = new THREE.Vector3();
		let facing = 1;
		let turn = 0;
		let heading = 0;
		let nextBlink = 2;
		let hop = 0;
		const squashSpring = new Spring(160, 10);
		const was = new THREE.Vector3();
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
		// Which way she turns to walk or run on the spot: towards the path, where there is room.
		let trickSide = 1;
		// While she walks or runs she keeps her eyes on the way ahead.
		const zero = new THREE.Vector2();
		/** The clip she's on the path in, and how fast it plays. */
		let gait: NixClip = 'Idle';
		let gaitSpeed = 1;

		/** The jump clip for the leap she's in, and for a hop. */
		let leapClip: NixJump = 'Jump';
		let hopClip: NixJump = 'Jump';
		const onFeet = () => free || onPath;
		const leap = (target: THREE.Vector3, land: typeof landing) => {
			// Called before she's moved, so she still knows if she's leaving a seat or her feet.
			leapClip = onFeet() ? (land === 'perch' ? 'JumpUp' : 'JumpStand') : land === 'perch' ? 'Jump' : 'JumpDown';
			from.copy(root.position);
			to.copy(target);
			const distance = from.distanceTo(to);
			jumpTime = reduceMotion ? 0.01 : 0.55 + Math.min(distance, 60) * 0.012;
			arc = reduceMotion ? 0 : 1.2 + Math.min(distance, 60) * 0.07;
			jump = 0;
			landing = land;
			trick = null;
			facing = to.x < from.x ? -1 : 1;
			flat.scale.x = facing;
			heading = Math.atan2(to.x - from.x, to.z - from.z);
			squashSpring.velocity -= 4;
		};

		/** Walk her along the path towards where the page has scrolled to; returns her speed. */
		const stroll = (dt: number) => {
			const want = Math.round(scroll);
			// Close to a stop, she heads for it rather than keeping pace with the scroll.
			const settling = Math.abs(scroll - want) < 0.3;
			const target = settling ? want : THREE.MathUtils.clamp(scroll, 0, stops.length - 1);
			const leg = legLength[THREE.MathUtils.clamp(Math.floor(s), 0, legLength.length - 1)];
			const gap = (target - s) * leg;
			// She dawdles over a little way and sprints to catch up over a long one.
			const speed = Math.min(11, Math.abs(gap) * 2.2 + 0.8);
			const step = Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
			s += step / leg;
			was.copy(root.position);
			pathAt(s, root.position);
			const moved = root.position.distanceTo(was);
			if (moved > 1e-4) heading = Math.atan2(root.position.x - was.x, root.position.z - was.z);
			if (settling && Math.abs(s - want) < 1e-3) {
				s = want;
				stop = want;
				leap(perchOf(want), 'perch');
				onPath = false;
			}
			return moved / Math.max(dt, 1e-4);
		};

		const WALK = 3;
		const RUN = 7.5;
		/** Steer her about the ground with the keys; returns her speed. */
		const drive = (dt: number) => {
			vel.lerp(steer.clone().multiplyScalar(running ? RUN : WALK), 1 - Math.exp(-10 * dt));
			was.copy(root.position);
			root.position.addScaledVector(vel, dt);
			root.position.y = FLOOR_Y;
			collide(root.position);
			const moved = Math.hypot(root.position.x - was.x, root.position.z - was.z);
			if (vel.lengthSq() > 0.04) heading = Math.atan2(vel.x, vel.z);
			return moved / Math.max(dt, 1e-4);
		};

		return {
			root,
			squash,
			get solid() {
				return solid;
			},
			setSolid,
			/** Resolves once the 3D figure is in. */
			ready: figure.ready,
			/** Whether she can get about on foot just now: the 3D figure, loaded, with motion allowed. */
			get canWalk() {
				return walks();
			},
			/** The stop she belongs to: the one she sits on, or last sat on or was sent up to. */
			get stop() {
				return stop;
			},
			get state() {
				return jump < 1 ? 'air' : free ? 'free' : onPath ? 'path' : 'perched';
			},
			/** The stop she is standing by or sitting on, or -1 when she's out on her own. */
			get near() {
				if (!roam) return Math.round(scroll);
				if (!free && !onPath) return stop;
				return stationNear(root.position);
			},
			/** Switch between walking her about with the keys and following the scroll. */
			setRoam(on: boolean) {
				if (on === roam) return;
				roam = on;
				if (on) {
					// Out on the path she just carries on from where she is.
					if (onPath) {
						onPath = false;
						free = true;
					}
				} else {
					steer.set(0, 0, 0);
					vel.set(0, 0, 0);
					if (free) {
						const k = stationNear(root.position, Infinity);
						stop = k;
						leap(perchOf(k), 'perch');
						free = false;
					}
				}
			},
			/** The way the keys point, on the ground, and whether Shift is held. */
			steer(direction: THREE.Vector3, run: boolean) {
				steer.copy(direction);
				running = run;
			},
			/** E: sit on the perch she's by, or get down off the one she's on. */
			act() {
				if (!roam || jump < 1) return;
				if (free) {
					const k = stationNear(root.position);
					if (k < 0) return;
					stop = k;
					leap(perchOf(k), 'perch');
					free = false;
				} else if (!onPath) {
					leap(anchors[stop], 'free');
				}
			},
			hop() {
				if (hop > 0 || jump < 1) return;
				hopClip = onFeet() ? 'JumpStand' : 'Jump';
				hop = 1;
				// The landing clip bends her knees, so her feet need no squash of their own.
				if (!onFeet()) squashSpring.velocity -= 3;
			},
			/** Where the page has scrolled to, in stops. */
			follow(p: number) {
				scroll = p;
				if (roam) return;
				const want = Math.round(p);
				if (jump < 1) return;
				if (walks()) {
					// Off her perch and down to the path as soon as the page starts moving on.
					if (!onPath && Math.abs(p - stop) > 0.3) {
						s = stop;
						leap(pathAt(stop), 'path');
					}
				} else if (onPath || want !== stop) {
					onPath = false;
					stop = want;
					leap(perchOf(want), 'perch');
				}
			},
			poke() {
				if (!walks() || jump < 1 || onPath || free) {
					hopClip = onFeet() ? 'JumpStand' : 'Jump';
					hop = 1;
					if (!(solid && onFeet())) squashSpring.velocity -= solid ? 3 : 5;
					return;
				}
				trick = tricks[nextTrick];
				nextTrick = (nextTrick + 1) % tricks.length;
				trickLeft = trick.time;
				trickSide = root.position.x > pathAt(stop).x ? -1 : 1;
				if (trick.clip === 'Hop') {
					hopClip = 'Jump';
					hop = 1;
					squashSpring.velocity -= 3;
					trick = null;
				}
			},
			tick(dt: number, time: number, look: THREE.Vector2) {
				let speed = 0;
				if (jump < 1) {
					jump = Math.min(1, jump + dt / jumpTime);
					const t = smooth(jump);
					root.position.lerpVectors(from, to, t);
					root.position.y += Math.sin(Math.PI * jump) * arc;
					root.rotation.z = Math.sin(Math.PI * jump) * -0.25 * facing;
					if (jump === 1) {
						// The flat sprite lands with a squash. The figure's landings are in her clips: a soft
						// one onto a seat, and onto her feet a landing clip that bends her knees, so no bounce.
						if (!solid) squashSpring.velocity -= 7;
						else if (landing === 'perch') squashSpring.velocity -= 2;
						root.rotation.z = 0;
						onPath = landing === 'path';
						free = landing === 'free';
						if (landing === 'perch') heading = 0;
					}
				} else if (free) {
					speed = drive(dt);
				} else if (onPath) {
					speed = stroll(dt);
				} else {
					root.position.copy(to);
					// Set off walking and she hops down off her perch first.
					if (roam && steer.lengthSq() > 0 && walks()) leap(anchors[stop], 'free');
				}
				if (hop > 0) {
					hop = Math.max(0, hop - dt * (solid ? 1.5 : 2.4));
					// On her feet she can really spring up; off a seat it's only a little hop.
					root.position.y += Math.sin(Math.PI * (1 - hop)) * (solid && hopClip === 'JumpStand' ? 1.1 : 0.6);
				}
				const sq = squashSpring.step(dt);
				squash.scale.set(1 - sq * 0.12, 1 + sq * 0.18, solid ? 1 - sq * 0.12 : 1);
				const airborne = jump < 1 || hop > 0;
				if (solid) {
					if (trick) {
						trickLeft -= dt;
						if (trickLeft <= 0) trick = null;
					}
					const strolling = trick !== null && trick.clip !== 'Wave';
					if ((onPath || free) && jump === 1) {
						// The gait follows her pace; the clips are cut for about 1.5 (walk) and 4.2 (run) a second.
						const next: NixClip = speed > 3 ? 'Run' : speed > 0.25 ? 'Walk' : 'Idle';
						if (next !== gait) gait = next;
						gaitSpeed = gait === 'Run' ? THREE.MathUtils.clamp(speed / 4.2, 0.8, 2.4) : gait === 'Walk' ? THREE.MathUtils.clamp(speed / 1.5, 0.6, 1.8) : 1;
						figure.play(gait, gaitSpeed);
						// Standing still on the path, she turns round to face the camera.
						if (gait === 'Idle' && onPath) heading = 0;
					} else {
						// Leaping down to her feet, she's already standing when she lands rather than getting up.
						const standingUp = jump < 1 && landing !== 'perch';
						figure.play(trick ? (trick.clip as NixClip) : standingUp ? 'Idle' : 'Sit');
					}
					// The figure faces where she's going, then turns back to the camera once she's sat down.
					const turnTo = jump < 1 && !reduceMotion ? heading : onPath || free ? heading : strolling ? trickSide * 1.15 : 0;
					turn += Math.atan2(Math.sin(turnTo - turn), Math.cos(turnTo - turn)) * (1 - Math.exp(-8 * dt));
					figure.group.rotation.y = turn;
					const flight = jump < 1 ? { t: jump, clip: leapClip } : hop > 0 ? { t: 1 - hop, clip: hopClip } : null;
					const busy = strolling || ((onPath || free) && gait !== 'Idle');
					figure.tick(dt, time, { airborne, look: busy ? zero : look, still: reduceMotion, jump: flight });
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
			// The flat sprite can't walk, so walking about ends with the 3D figure.
			if (nix.solid) setRoam(false, false);
			nix.setSolid(!nix.solid);
			label();
			roamLabel();
			try {
				localStorage.setItem('nix-mode', nix.solid ? '3d' : '2d');
			} catch {
				// The choice just won't be remembered.
			}
		});
	}

	// ---------- walking about with the keys ----------
	// On a computer, she can be walked about the world with WASD while the mouse drags the camera round
	// her. Phones, the flat sprite and reduced motion keep the scroll tour, which is always one click away.
	const roamButton = document.querySelector<HTMLButtonElement>('[data-roam]');
	const keyhint = document.querySelector<HTMLElement>('[data-keyhint]');
	const keyhintAct = keyhint?.querySelector<HTMLElement>('[data-keyhint-act]') ?? null;
	const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
	const roamable = () => finePointer && nix.canWalk;
	let roam = false;
	const keys = new Set<string>();
	let orbitYaw = 0;
	let orbitPitch = 0.4;
	let orbitDistance = 11;
	const steerDir = new THREE.Vector3();
	const orbitDir = new THREE.Vector3();
	const roamTarget = new THREE.Vector3();
	const wallRay = new THREE.Raycaster();
	let nearShown = -2;
	let actShown = '';
	const roamLabel = () => {
		if (!roamButton) return;
		roamButton.hidden = !roamable();
		roamButton.textContent = roam ? 'Walk: WASD' : 'Walk: scroll';
		roamButton.setAttribute('aria-pressed', String(roam));
	};
	function setRoam(on: boolean, remember = true) {
		on = on && roamable();
		if (on === roam) return;
		// Where she is, asked before she stops being steered, while she still knows.
		const wasNear = nix.near;
		roam = on;
		document.documentElement.classList.toggle('roam', roam);
		nix.setRoam(roam);
		keys.clear();
		if (keyhint) keyhint.hidden = !roam;
		if (roam) {
			// Pick the camera up from wherever the scroll tour left it.
			orbitYaw = Math.atan2(camPos.x - nix.root.position.x, camPos.z - nix.root.position.z);
		} else {
			sections.forEach((section) => section.classList.remove('near'));
			nearShown = -2;
			// Back on the page, scrolled straight to the stop she's at or heading up to, before the
			// scroll tour gets a chance to send her somewhere else.
			const k = wasNear >= 0 ? wasNear : nix.stop;
			sections[k]?.scrollIntoView({ block: 'center', behavior: 'instant' });
		}
		roamLabel();
		if (remember) {
			try {
				localStorage.setItem('nix-roam', roam ? 'on' : 'off');
			} catch {
				// The choice just won't be remembered.
			}
		}
	}
	roamButton?.addEventListener('click', () => setRoam(!roam));
	nix.ready.then(
		() => {
			let wanted = true;
			try {
				wanted = localStorage.getItem('nix-roam') !== 'off';
			} catch {
				// Walk about by default.
			}
			roamLabel();
			if (wanted) setRoam(true, false);
		},
		() => {},
	);

	const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
	addEventListener('keydown', (e) => {
		if (!roam || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target instanceof Element ? e.target : null;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const key = e.key.toLowerCase();
		if (MOVE_KEYS.includes(key)) {
			keys.add(key);
			if (key.startsWith('arrow')) e.preventDefault();
		} else if (key === ' ') {
			// Space still presses a focused button or link.
			if (target?.closest('a, button')) return;
			e.preventDefault();
			nix.hop();
		} else if (key === 'e' && !e.repeat) {
			nix.act();
		}
	});
	addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
	addEventListener('blur', () => keys.clear());
	canvas.addEventListener('pointermove', (e) => {
		if (!roam || !(e.buttons & 1)) return;
		orbitYaw -= e.movementX * 0.006;
		orbitPitch = THREE.MathUtils.clamp(orbitPitch + e.movementY * 0.004, 0.06, 1.15);
	});
	addEventListener(
		'wheel',
		(e) => {
			if (!roam) return;
			e.preventDefault();
			orbitDistance = THREE.MathUtils.clamp(orbitDistance * Math.exp(e.deltaY * 0.0012), 4.5, 22);
		},
		{ passive: false },
	);

	/** One frame of walking about: steer her from the keys, and swing the camera round behind her. */
	const roamFrame = (dt: number) => {
		const held = (...names: string[]) => (names.some((n) => keys.has(n)) ? 1 : 0);
		const forward = held('w', 'arrowup') - held('s', 'arrowdown');
		const right = held('d', 'arrowright') - held('a', 'arrowleft');
		// The keys point the way the camera faces.
		steerDir.set(-Math.sin(orbitYaw) * forward + Math.cos(orbitYaw) * right, 0, -Math.cos(orbitYaw) * forward - Math.sin(orbitYaw) * right);
		if (steerDir.lengthSq() > 1) steerDir.normalize();
		nix.steer(steerDir, keys.has('shift'));

		roamTarget.copy(nix.root.position).y += 1.5;
		camLook.x = damp(camLook.x, roamTarget.x, 9, dt);
		camLook.y = damp(camLook.y, roamTarget.y, 6, dt);
		camLook.z = damp(camLook.z, roamTarget.z, 9, dt);
		orbitDir.set(Math.sin(orbitYaw) * Math.cos(orbitPitch), Math.sin(orbitPitch), Math.cos(orbitYaw) * Math.cos(orbitPitch));
		// Never through a station's wall: if one is in the way, come in in front of it.
		let distance = orbitDistance;
		wallRay.set(camLook, orbitDir);
		wallRay.far = orbitDistance;
		const blocked = wallRay.intersectObjects(walls, false)[0];
		if (blocked) distance = Math.max(2.2, blocked.distance - 0.5);
		camPos.copy(camLook).addScaledVector(orbitDir, distance);
		camPos.y = Math.max(camPos.y, FLOOR_Y + 0.6);

		// The card for the station she's by fades in beside her.
		const near = nix.near;
		if (near !== nearShown) {
			nearShown = near;
			sections.forEach((section, i) => section.classList.toggle('near', i === near));
		}
		const side = near >= 0 && !narrow ? -0.13 : 0;
		viewShift = { x: damp(viewShift.x, side, 4, dt), y: damp(viewShift.y, 0, 4, dt) };
		const state = nix.state;
		const act = state === 'perched' ? 'get down' : state === 'free' && near >= 0 ? 'sit here' : '';
		if (act !== actShown && keyhintAct) {
			actShown = act;
			keyhintAct.hidden = !act;
			const label = keyhintAct.querySelector('span');
			if (label) label.textContent = act;
		}
	};

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
	const behind = new THREE.Vector3();
	const ahead = new THREE.Vector3();
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
		wantPos.set(wantLook.x + swing, wantLook.y + 1.2 + distance * 0.08, wantLook.z + distance);
		// Between stops the camera leaves the stations and walks the path itself, a little behind
		// and above, looking on down the way, so it goes round the stations rather than through them.
		const walk = Math.sin(Math.PI * f) ** 0.7;
		if (walk > 0) {
			const at = i + f;
			pathAt(Math.max(0, at - 0.34), behind);
			pathAt(Math.min(stops.length - 1, at + 0.32), ahead);
			behind.y += 7.5;
			ahead.y += 0.5;
			wantPos.lerp(behind, walk);
			wantLook.lerp(ahead, walk);
		}
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
	renderer.setAnimationLoop(() => {
		const dt = Math.min(clock.getDelta(), 0.05);
		const time = clock.elapsedTime;
		if (roam && !roamable()) setRoam(false, false);
		if (roam) {
			roamFrame(dt);
		} else {
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
			nix.follow(p);
		}
		camera.position.copy(camPos);
		camera.lookAt(camLook);
		camera.setViewOffset(width, height, viewShift.x * width, viewShift.y * height, width, height);

		sun.target.position.copy(camLook);
		sun.position.copy(camLook).add(new THREE.Vector3(-7, 13, 12));

		sky.position.copy(camera.position);
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
