// The effects kit for /skills: one big pool of additive particles, and short-lived pieces (rings,
// rune circles, pillars of light, slashes, ice crystals, damage numbers) that each run themselves
// down and tidy up after. Everything here is told the game's time step, so slow motion and the
// little freezes on a hit slow the effects with it.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number) => {
	const c = 1.9;
	return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	paint(canvas.getContext('2d')!, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

/** White on black: the shapes the particles can take, two by two. */
export const enum Kind {
	Glow = 0,
	Flake = 1,
	Spark = 2,
	Shard = 3,
}

function particleAtlas() {
	return canvasTexture(256, (ctx) => {
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, 256, 256);
		const cell = (i: number, draw: () => void) => {
			ctx.save();
			ctx.translate((i % 2) * 128 + 64, Math.floor(i / 2) * 128 + 64);
			draw();
			ctx.restore();
		};
		cell(Kind.Glow, () => {
			const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 62);
			g.addColorStop(0, 'rgba(255,255,255,1)');
			g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
			g.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = g;
			ctx.fillRect(-64, -64, 128, 128);
		});
		cell(Kind.Flake, () => {
			ctx.strokeStyle = '#fff';
			ctx.lineCap = 'round';
			ctx.lineWidth = 7;
			ctx.shadowColor = '#fff';
			ctx.shadowBlur = 10;
			for (let i = 0; i < 6; i++) {
				ctx.save();
				ctx.rotate((i * Math.PI) / 3);
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.lineTo(0, -52);
				ctx.moveTo(0, -30);
				ctx.lineTo(-14, -44);
				ctx.moveTo(0, -30);
				ctx.lineTo(14, -44);
				ctx.stroke();
				ctx.restore();
			}
		});
		cell(Kind.Spark, () => {
			// A four-pointed twinkle.
			const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
			g.addColorStop(0, 'rgba(255,255,255,1)');
			g.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = g;
			ctx.fillRect(-64, -64, 128, 128);
			ctx.fillStyle = '#fff';
			for (const r of [0, Math.PI / 2]) {
				ctx.save();
				ctx.rotate(r);
				ctx.beginPath();
				ctx.moveTo(0, -60);
				ctx.quadraticCurveTo(4, 0, 0, 60);
				ctx.quadraticCurveTo(-4, 0, 0, -60);
				ctx.fill();
				ctx.restore();
			}
		});
		cell(Kind.Shard, () => {
			// A thin splinter of ice, bright along its spine.
			const g = ctx.createLinearGradient(-14, 0, 14, 0);
			g.addColorStop(0, 'rgba(255,255,255,0.15)');
			g.addColorStop(0.5, 'rgba(255,255,255,1)');
			g.addColorStop(1, 'rgba(255,255,255,0.15)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(0, -60);
			ctx.lineTo(14, 8);
			ctx.lineTo(0, 56);
			ctx.lineTo(-12, 4);
			ctx.closePath();
			ctx.fill();
		});
	});
}

export interface Emit {
	pos: THREE.Vector3;
	vel?: THREE.Vector3;
	life: number;
	/** Size at birth and at death, in world units. */
	size: [number, number];
	/** Colour, which may run brighter than 1 to bloom. */
	color: THREE.Color;
	alpha?: number;
	kind?: Kind;
	gravity?: number;
	drag?: number;
	spin?: number;
	/** Its turn in the plane of the screen at birth; random if not given. */
	angle?: number;
	/** Fades in over this share of its life rather than starting at full strength. */
	fadeIn?: number;
}

const MAX = 9000;

/** All the little bright bits, in one draw. */
export function createParticles(scene: THREE.Scene) {
	const geo = new THREE.BufferGeometry();
	const position = new Float32Array(MAX * 3);
	const tint = new Float32Array(MAX * 4);
	const size = new Float32Array(MAX);
	const kind = new Float32Array(MAX);
	const angle = new Float32Array(MAX);
	const attr = (array: Float32Array, n: number) => new THREE.BufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage);
	const posAttr = attr(position, 3);
	const tintAttr = attr(tint, 4);
	const sizeAttr = attr(size, 1);
	const kindAttr = attr(kind, 1);
	const angleAttr = attr(angle, 1);
	geo.setAttribute('position', posAttr);
	geo.setAttribute('tint', tintAttr);
	geo.setAttribute('size', sizeAttr);
	geo.setAttribute('kind', kindAttr);
	geo.setAttribute('angle', angleAttr);
	geo.setDrawRange(0, 0);
	const material = new THREE.ShaderMaterial({
		uniforms: { atlas: { value: particleAtlas() }, scale: { value: 800 } },
		vertexShader: /* glsl */ `
			attribute vec4 tint;
			attribute float size;
			attribute float kind;
			attribute float angle;
			uniform float scale;
			varying vec4 vTint;
			varying vec2 vCell;
			varying float vAngle;
			void main() {
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mv;
				gl_PointSize = size * scale / -mv.z;
				vTint = tint;
				vCell = vec2(mod(kind, 2.0), floor(kind / 2.0));
				vAngle = angle;
			}`,
		fragmentShader: /* glsl */ `
			uniform sampler2D atlas;
			varying vec4 vTint;
			varying vec2 vCell;
			varying float vAngle;
			void main() {
				vec2 p = gl_PointCoord - 0.5;
				float c = cos(vAngle), s = sin(vAngle);
				p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
				if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
				// Canvas rows run down from the top, and the texture's flipped so v runs up.
				vec2 uv = vec2((vCell.x + p.x) * 0.5, 1.0 - (vCell.y + p.y) * 0.5);
				float a = texture2D(atlas, uv).r * vTint.a;
				if (a < 0.003) discard;
				gl_FragColor = vec4(vTint.rgb, a);
			}`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});
	const points = new THREE.Points(geo, material);
	points.frustumCulled = false;
	points.renderOrder = 5;
	scene.add(points);

	// The particles themselves, packed at the front of these arrays.
	const vel = new Float32Array(MAX * 3);
	const life = new Float32Array(MAX);
	const age = new Float32Array(MAX);
	const size0 = new Float32Array(MAX);
	const size1 = new Float32Array(MAX);
	const color = new Float32Array(MAX * 3);
	const alpha = new Float32Array(MAX);
	const gravity = new Float32Array(MAX);
	const drag = new Float32Array(MAX);
	const spin = new Float32Array(MAX);
	const fadeIn = new Float32Array(MAX);
	let count = 0;

	const copy = (from: number, to: number) => {
		for (let k = 0; k < 3; k++) {
			position[to * 3 + k] = position[from * 3 + k];
			vel[to * 3 + k] = vel[from * 3 + k];
			color[to * 3 + k] = color[from * 3 + k];
		}
		for (const a of [life, age, size0, size1, alpha, gravity, drag, spin, fadeIn, kind, angle]) a[to] = a[from];
	};

	return {
		points,
		setScale(px: number) {
			material.uniforms.scale.value = px;
		},
		emit(e: Emit) {
			if (count >= MAX) return;
			const i = count++;
			position.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
			vel.set(e.vel ? [e.vel.x, e.vel.y, e.vel.z] : [0, 0, 0], i * 3);
			color.set([e.color.r, e.color.g, e.color.b], i * 3);
			life[i] = e.life;
			age[i] = 0;
			size0[i] = e.size[0];
			size1[i] = e.size[1];
			alpha[i] = e.alpha ?? 1;
			gravity[i] = e.gravity ?? 0;
			drag[i] = e.drag ?? 0;
			spin[i] = e.spin ?? 0;
			fadeIn[i] = e.fadeIn ?? 0;
			kind[i] = e.kind ?? Kind.Glow;
			angle[i] = e.angle ?? Math.random() * TAU;
		},
		update(dt: number) {
			let i = 0;
			while (i < count) {
				age[i] += dt;
				if (age[i] >= life[i]) {
					copy(--count, i);
					continue;
				}
				const k = Math.exp(-drag[i] * dt);
				vel[i * 3] *= k;
				vel[i * 3 + 1] = vel[i * 3 + 1] * k - gravity[i] * dt;
				vel[i * 3 + 2] *= k;
				for (let c = 0; c < 3; c++) position[i * 3 + c] += vel[i * 3 + c] * dt;
				angle[i] += spin[i] * dt;
				const t = age[i] / life[i];
				const inA = fadeIn[i] > 0 ? Math.min(1, t / fadeIn[i]) : 1;
				const outA = 1 - t * t;
				for (let c = 0; c < 3; c++) tint[i * 4 + c] = color[i * 3 + c];
				tint[i * 4 + 3] = alpha[i] * inA * outA;
				size[i] = size0[i] + (size1[i] - size0[i]) * t;
				i++;
			}
			geo.setDrawRange(0, count);
			for (const a of [posAttr, tintAttr, sizeAttr, kindAttr, angleAttr]) {
				a.clearUpdateRanges();
				a.addUpdateRange(0, count * a.itemSize);
				a.needsUpdate = true;
			}
		},
		get count() {
			return count;
		},
	};
}
export type Particles = ReturnType<typeof createParticles>;

/** A random direction, optionally kept within `spread` radians of `around`. */
export function randomDir(around?: THREE.Vector3, spread = Math.PI) {
	const v = new THREE.Vector3().randomDirection();
	if (!around) return v;
	const axis = around.clone().normalize();
	const cos = Math.cos(spread);
	const z = rand(cos, 1);
	const r = Math.sqrt(1 - z * z);
	const phi = rand(0, TAU);
	const local = new THREE.Vector3(r * Math.cos(phi), r * Math.sin(phi), z);
	return local.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
}

/** Throw `n` particles out from a point. */
export function burst(p: Particles, at: THREE.Vector3, n: number, o: Omit<Emit, 'pos' | 'vel' | 'life'> & { speed: [number, number]; life: [number, number]; dir?: THREE.Vector3; spread?: number }) {
	for (let i = 0; i < n; i++) {
		const v = randomDir(o.dir, o.spread ?? Math.PI).multiplyScalar(rand(...o.speed));
		p.emit({ ...o, pos: at.clone(), vel: v, life: rand(...o.life), spin: o.spin ?? rand(-6, 6) });
	}
}

// ---------- pieces that live for a moment ----------

export interface Effect {
	/** Moves it on; false once it's done and may be tidied away. */
	update(dt: number): boolean;
	dispose(): void;
}

export function createEffects(scene: THREE.Scene) {
	const live: Effect[] = [];
	return {
		add<T extends Effect>(e: T) {
			live.push(e);
			return e;
		},
		update(dt: number) {
			for (let i = live.length - 1; i >= 0; i--) {
				if (!live[i].update(dt)) {
					live[i].dispose();
					live.splice(i, 1);
				}
			}
		},
		scene,
	};
}
export type Effects = ReturnType<typeof createEffects>;

const additive = (extra: THREE.ShaderMaterialParameters) =>
	new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...extra });

function meshEffect(fx: Effects, mesh: THREE.Object3D, life: number, step: (t: number, dt: number) => void, materials: THREE.Material[], geometries: THREE.BufferGeometry[]): Effect {
	fx.scene.add(mesh);
	let age = 0;
	return fx.add({
		update(dt) {
			age += dt;
			const t = Math.min(age / life, 1);
			step(t, dt);
			return age < life;
		},
		dispose() {
			mesh.removeFromParent();
			for (const m of materials) m.dispose();
			for (const g of geometries) g.dispose();
		},
	});
}

/** A ring of light spreading out from `at`, lying in the plane facing `normal` (up, by default). */
export function shockwave(fx: Effects, at: THREE.Vector3, o: { radius: number; life: number; color: THREE.Color; width?: number; normal?: THREE.Vector3; from?: number }) {
	const geo = new THREE.PlaneGeometry(o.radius * 2, o.radius * 2);
	const mat = additive({
		uniforms: { progress: { value: 0 }, color: { value: o.color }, width: { value: o.width ?? 0.08 }, from: { value: o.from ?? 0.05 } },
		vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `
			uniform float progress; uniform vec3 color; uniform float width; uniform float from;
			varying vec2 vUv;
			void main() {
				float d = length(vUv - 0.5) * 2.0;
				float e = 1.0 - pow(1.0 - progress, 3.0);
				float r = mix(from, 1.0, e);
				float w = width * (1.0 - 0.5 * progress);
				// A bright leading edge with a soft wash trailing inside it.
				float band = smoothstep(w, 0.0, abs(d - r)) + smoothstep(r, r * 0.4, d) * 0.12 * step(d, r);
				float a = band * (1.0 - progress) * (1.0 - progress);
				gl_FragColor = vec4(color, a);
			}`,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.copy(at);
	mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), (o.normal ?? new THREE.Vector3(0, 1, 0)).clone().normalize());
	mesh.renderOrder = 4;
	return meshEffect(fx, mesh, o.life, (t) => (mat.uniforms.progress.value = t), [mat], [geo]);
}

/** A rune circle, painted once and shared by every circle drawn. */
let runeTexture: THREE.Texture | null = null;
function runes() {
	if (runeTexture) return runeTexture;
	runeTexture = canvasTexture(1024, (ctx, n) => {
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, n, n);
		ctx.translate(n / 2, n / 2);
		ctx.strokeStyle = ctx.fillStyle = '#fff';
		ctx.lineCap = ctx.lineJoin = 'round';
		ctx.shadowColor = '#fff';
		ctx.shadowBlur = 12;
		const ring = (r: number, w: number) => {
			ctx.lineWidth = w;
			ctx.beginPath();
			ctx.arc(0, 0, r, 0, TAU);
			ctx.stroke();
		};
		ring(500, 10);
		ring(470, 4);
		ring(330, 6);
		ring(300, 3);
		ring(120, 5);
		// A band of runes between the outer rings: little made-up letters of strokes and dots.
		const glyphs = 36;
		for (let i = 0; i < glyphs; i++) {
			ctx.save();
			ctx.rotate((i / glyphs) * TAU);
			ctx.translate(0, -400);
			ctx.lineWidth = 5;
			const seed = (i * 7919) % 13;
			ctx.beginPath();
			ctx.moveTo(-14, -24);
			ctx.lineTo(seed % 2 ? 14 : 0, seed % 3 ? 24 : 0);
			if (seed % 4 < 2) {
				ctx.moveTo(-14, 6);
				ctx.lineTo(14, -6);
			}
			if (seed % 5 > 1) {
				ctx.moveTo(10, -24);
				ctx.lineTo(10, 18);
			}
			ctx.stroke();
			if (seed % 3 === 0) {
				ctx.beginPath();
				ctx.arc(-4, 22, 5, 0, TAU);
				ctx.fill();
			}
			ctx.restore();
		}
		// A six-pointed star of two triangles, and a snowflake at the heart.
		ctx.lineWidth = 6;
		for (const off of [0, Math.PI / 3]) {
			ctx.beginPath();
			for (let k = 0; k <= 3; k++) {
				const a = off + (k / 3) * TAU - Math.PI / 2;
				const fn = k ? ctx.lineTo : ctx.moveTo;
				fn.call(ctx, Math.cos(a) * 300, Math.sin(a) * 300);
			}
			ctx.stroke();
		}
		for (let k = 0; k < 6; k++) {
			ctx.save();
			ctx.rotate((k * Math.PI) / 3);
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(0, -110);
			ctx.moveTo(0, -60);
			ctx.lineTo(-30, -90);
			ctx.moveTo(0, -60);
			ctx.lineTo(30, -90);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(0, -315, 14, 0, TAU);
			ctx.stroke();
			ctx.restore();
		}
	});
	return runeTexture;
}

export interface Circle {
	mesh: THREE.Mesh;
	/** Starts it fading out over `time` seconds, after which it's gone. */
	close(time?: number): void;
}

/** A rune circle that opens out, turns, and stays until it's closed. */
export function runeCircle(fx: Effects, at: THREE.Vector3, o: { radius: number; color: THREE.Color; normal?: THREE.Vector3; spin?: number; open?: number }): Circle {
	const geo = new THREE.PlaneGeometry(o.radius * 2, o.radius * 2);
	const mat = additive({
		uniforms: { map: { value: runes() }, color: { value: o.color }, strength: { value: 0 }, reveal: { value: 0 } },
		vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `
			uniform sampler2D map; uniform vec3 color; uniform float strength; uniform float reveal;
			varying vec2 vUv;
			void main() {
				vec2 p = vUv - 0.5;
				// Drawn round from the top as it opens, like a pen tracing it.
				float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
				float shown = smoothstep(reveal, reveal - 0.04, a);
				float ink = texture2D(map, vUv).r;
				gl_FragColor = vec4(color, ink * strength * shown);
			}`,
	});
	const mesh = new THREE.Mesh(geo, mat);
	const holder = new THREE.Group();
	holder.position.copy(at);
	holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), (o.normal ?? new THREE.Vector3(0, 1, 0)).clone().normalize());
	holder.add(mesh);
	mesh.renderOrder = 3;
	let age = 0;
	let closing: { at: number; time: number } | null = null;
	const open = o.open ?? 0.5;
	fx.add({
		update(dt) {
			age += dt;
			const t = Math.min(age / open, 1);
			mat.uniforms.reveal.value = easeOut(t) * 1.05;
			mesh.scale.setScalar(0.6 + 0.4 * easeOutBack(t));
			mesh.rotation.z += (o.spin ?? 0.6) * dt;
			let s = 1;
			if (closing) {
				const c = (age - closing.at) / closing.time;
				if (c >= 1) return false;
				s = 1 - c;
				mesh.scale.multiplyScalar(1 + 0.25 * c);
			}
			mat.uniforms.strength.value = s * (0.85 + 0.15 * Math.sin(age * 9));
			return true;
		},
		dispose() {
			holder.removeFromParent();
			mat.dispose();
			geo.dispose();
		},
	});
	fx.scene.add(holder);
	return {
		mesh,
		close(time = 0.4) {
			if (!closing) closing = { at: age, time };
		},
	};
}

/** A column of light rising from `at`, brightest at its foot, with bands running up it. */
export function pillar(fx: Effects, at: THREE.Vector3, o: { radius: number; height: number; life: number; color: THREE.Color }) {
	const geo = new THREE.CylinderGeometry(o.radius, o.radius * 1.15, o.height, 40, 1, true);
	geo.translate(0, o.height / 2, 0);
	const mat = additive({
		uniforms: { color: { value: o.color }, time: { value: 0 }, strength: { value: 0 } },
		vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `
			uniform vec3 color; uniform float time; uniform float strength;
			varying vec2 vUv;
			void main() {
				float bands = 0.55 + 0.45 * sin(vUv.y * 22.0 - time * 9.0 + sin(vUv.x * 37.7) * 1.5);
				float fade = pow(1.0 - vUv.y, 1.6);
				gl_FragColor = vec4(color, fade * bands * strength);
			}`,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.copy(at);
	mesh.renderOrder = 4;
	return meshEffect(
		fx,
		mesh,
		o.life,
		(t, dt) => {
			mat.uniforms.time.value += dt;
			// Snaps on, holds, and narrows away.
			mat.uniforms.strength.value = Math.min(1, t * 8) * (1 - smoothstepJS(0.6, 1, t));
			const w = 1 - 0.7 * smoothstepJS(0.6, 1, t);
			mesh.scale.set(w, 1, w);
		},
		[mat],
		[geo],
	);
}

function smoothstepJS(a: number, b: number, x: number) {
	const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
}

/** A crescent slash through `at`: a swept band of light that draws across and thins away.
 * `tilt` turns the cut about the line to the camera; `facing` is the plane's normal. */
export function slash(fx: Effects, at: THREE.Vector3, o: { radius: number; life: number; color: THREE.Color; tilt: number; facing: THREE.Vector3; arc?: number; flip?: boolean }) {
	const arc = o.arc ?? Math.PI * 0.95;
	const geo = new THREE.RingGeometry(o.radius * 0.72, o.radius, 64, 1, -arc / 2, arc);
	const mat = additive({
		uniforms: { color: { value: o.color }, progress: { value: 0 }, arc: { value: arc }, inner: { value: 0.72 } },
		vertexShader: /* glsl */ `
			varying vec2 vP;
			void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `
			uniform vec3 color; uniform float progress; uniform float arc; uniform float inner;
			varying vec2 vP;
			void main() {
				float a = atan(vP.y, vP.x) / arc + 0.5;   // 0 → 1 along the cut
				float r = length(vP);
				float head = progress * 1.4;
				float along = smoothstep(head, head - 0.08, a) * smoothstep(head - 0.95, head - 0.3, a);
				// Thickest in the middle of the arc, tapering to points at both ends.
				float taper = sin(clamp(a, 0.0, 1.0) * 3.14159);
				float rr = (r / ${o.radius.toFixed(3)} - inner) / (1.0 - inner);
				float edge = smoothstep(1.0 - taper, 1.0, rr) * smoothstep(1.0, 0.92, rr);
				float fade = 1.0 - smoothstep(0.55, 1.0, progress);
				gl_FragColor = vec4(color * (1.0 + 0.8 * smoothstep(0.75, 1.0, rr)), along * edge * fade);
			}`,
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = 6;
	const holder = new THREE.Group();
	holder.position.copy(at);
	holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.facing.clone().normalize());
	mesh.rotation.z = o.tilt;
	if (o.flip) mesh.scale.y = -1;
	holder.add(mesh);
	return meshEffect(fx, holder, o.life, (t) => (mat.uniforms.progress.value = t), [mat], [geo]);
}

/** A soft glowing ball that can be moved and resized, for charges and bolts. */
export function glowBall(fx: Effects, color: THREE.Color, size: number) {
	const mat = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.setScalar(size);
	sprite.renderOrder = 6;
	fx.scene.add(sprite);
	return {
		sprite,
		remove() {
			sprite.removeFromParent();
			mat.dispose();
		},
	};
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
	return (glowTex ??= canvasTexture(128, (ctx) => {
		const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
		g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
	}));
}

// ---------- ice ----------

const iceMats: THREE.Material[] = [];
function iceMaterial() {
	if (iceMats.length) return iceMats[0];
	// Faceted, a little see-through, and lit from inside so it blooms faintly.
	const mat = new THREE.MeshStandardMaterial({
		color: '#bfe6ff',
		emissive: '#4f9cff',
		emissiveIntensity: 0.55,
		roughness: 0.15,
		metalness: 0.1,
		flatShading: true,
		transparent: true,
		opacity: 0.88,
	});
	iceMats.push(mat);
	return mat;
}

function crystalGeometry(height: number, radius: number) {
	// A five-sided point with a short neck, its base below the ground so it rises out of it.
	const geo = new THREE.CylinderGeometry(0, radius, height, 5, 2);
	const p = geo.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const y = p.getY(i);
		if (Math.abs(y) < 1e-4) {
			p.setX(i, p.getX(i) * 0.82);
			p.setZ(i, p.getZ(i) * 0.82);
		}
	}
	geo.translate(0, height / 2 - height * 0.12, 0);
	geo.computeVertexNormals();
	return geo;
}

export interface Crystal {
	group: THREE.Group;
	/** Breaks it apart into shards and lets it go. */
	shatter(): void;
}

/** A cluster of ice spikes bursting up out of the ground at `at`, held until shattered (or `hold` runs out). */
export function iceCluster(fx: Effects, particles: Particles, at: THREE.Vector3, o: { height: number; spikes?: number; hold?: number; tiltOut?: number; rise?: number }): Crystal {
	const group = new THREE.Group();
	group.position.copy(at);
	const geos: THREE.BufferGeometry[] = [];
	const n = o.spikes ?? 5;
	for (let i = 0; i < n; i++) {
		const main = i === 0;
		const h = o.height * (main ? 1 : rand(0.35, 0.7));
		const geo = crystalGeometry(h, h * rand(0.16, 0.22));
		geos.push(geo);
		const mesh = new THREE.Mesh(geo, iceMaterial());
		mesh.castShadow = true;
		const a = (i / n) * TAU + rand(-0.3, 0.3);
		const out = main ? 0 : o.tiltOut ?? 0.55;
		mesh.position.set(main ? 0 : Math.cos(a) * h * 0.18, 0, main ? 0 : Math.sin(a) * h * 0.18);
		mesh.rotation.set(Math.sin(a) * out + (main ? rand(-0.1, 0.1) : 0), rand(0, TAU), -Math.cos(a) * out + (main ? rand(-0.1, 0.1) : 0));
		group.add(mesh);
	}
	group.scale.set(1, 0.001, 1);
	fx.scene.add(group);
	const rise = o.rise ?? 0.16;
	const hold = o.hold ?? Infinity;
	let age = 0;
	let breaking = -1;
	const shatter = () => {
		if (breaking >= 0) return;
		breaking = 0;
		const top = new THREE.Vector3(0, o.height * 0.5, 0).add(at);
		burst(particles, top, Math.round(18 + o.height * 22), {
			kind: Kind.Shard,
			size: [o.height * 0.28, 0.02],
			color: new THREE.Color(1.6, 2.2, 3.2),
			speed: [2, 6 + o.height * 2],
			life: [0.5, 1.1],
			gravity: 9,
			drag: 1.2,
		});
		burst(particles, top, 14, { kind: Kind.Glow, size: [o.height * 0.5, 0.1], color: new THREE.Color(0.4, 0.8, 2), speed: [0.5, 2.5], life: [0.3, 0.6], drag: 2 });
	};
	fx.add({
		update(dt) {
			age += dt;
			if (breaking >= 0) {
				breaking += dt;
				const s = 1 - breaking / 0.12;
				if (s <= 0) return false;
				group.scale.setScalar(Math.max(s, 0.001));
				return true;
			}
			group.scale.y = Math.max(easeOutBack(Math.min(age / rise, 1)), 0.001);
			if (age > rise + hold) shatter();
			return true;
		},
		dispose() {
			group.removeFromParent();
			for (const g of geos) g.dispose();
		},
	});
	return { group, shatter };
}

// ---------- numbers ----------

/** A damage number that pops up off a hit and floats away. */
export function damageNumber(fx: Effects, at: THREE.Vector3, value: number, crit: boolean) {
	const tex = canvasTexture(256, (ctx) => {
		ctx.clearRect(0, 0, 256, 256);
		ctx.font = `${crit ? 112 : 84}px "Bagel Fat One", "Nunito", sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';
		ctx.lineWidth = 16;
		ctx.strokeStyle = crit ? '#3b1e58' : '#1d1b3a';
		ctx.strokeText(String(value), 128, 132);
		const g = ctx.createLinearGradient(0, 80, 0, 180);
		if (crit) {
			g.addColorStop(0, '#fff6b0');
			g.addColorStop(1, '#ffb347');
		} else {
			g.addColorStop(0, '#ffffff');
			g.addColorStop(1, '#a9d8ff');
		}
		ctx.fillStyle = g;
		ctx.fillText(String(value), 128, 132);
	});
	const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
	const sprite = new THREE.Sprite(mat);
	sprite.renderOrder = 20;
	sprite.position.copy(at);
	const drift = new THREE.Vector3(rand(-0.6, 0.6), rand(1.6, 2.2), rand(-0.3, 0.3));
	const base = crit ? 1.5 : 1.0;
	return meshEffect(
		fx,
		sprite,
		crit ? 1.2 : 0.9,
		(t, dt) => {
			sprite.position.addScaledVector(drift, dt * (1 - t));
			// Pops in big, settles, then shrinks away.
			const pop = t < 0.12 ? THREE.MathUtils.lerp(1.8, 1, t / 0.12) : 1;
			sprite.scale.setScalar(base * pop * (1 - smoothstepJS(0.75, 1, t) * 0.6));
			mat.opacity = 1 - smoothstepJS(0.7, 1, t);
		},
		[mat, { dispose: () => tex.dispose() } as THREE.Material],
		[],
	);
}
