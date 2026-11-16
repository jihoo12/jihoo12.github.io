// The 3D Nixchan figure for the experimental homepage. The model is built in Blender by
// tools/nixchan-3d/build.py; this file dresses it in toon shading with an inked outline, paints
// her face on, plays the clips baked into her rig, and turns her head and long hair on top of them.
// Her origin is where she sits: y = 0 is the surface, z = 0 is its front edge, and she faces +z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const NAVY = '#2c2a52';
const NAVY_DEEP = '#22203f';
const HAIR = '#eceafc';
const SKIN = '#fde9df';
const SNOW = '#5f9be8';
const INK = '#1d1b3a';


function toonRamp(steps = [150, 215, 255]) {
	const data = new Uint8Array(steps);
	const ramp = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
	ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
}

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	paint(canvas.getContext('2d')!);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

/** The head's skin, with the face painted where an equirectangular map puts the front (+z). */
function faceTexture(eyesClosed: boolean) {
	return canvasTexture(2048, 1024, (ctx) => {
		ctx.fillStyle = SKIN;
		ctx.fillRect(0, 0, 2048, 1024);
		// Work in radians around the front of the face: x along the equator, y down from it.
		const k = 1024 / Math.PI;
		ctx.translate(512, 512);
		ctx.scale(k, k);
		ctx.lineCap = ctx.lineJoin = 'round';

		for (const side of [-1, 1]) {
			const blush = ctx.createRadialGradient(side * 0.57, 0.47, 0, side * 0.57, 0.47, 0.14);
			blush.addColorStop(0, 'rgba(244, 146, 158, 0.6)');
			blush.addColorStop(1, 'rgba(244, 146, 158, 0)');
			ctx.fillStyle = blush;
			ctx.beginPath();
			ctx.ellipse(side * 0.57, 0.47, 0.15, 0.09, 0, 0, Math.PI * 2);
			ctx.fill();
			// The little hatch lines over the blush.
			ctx.strokeStyle = 'rgba(226, 112, 128, 0.75)';
			ctx.lineWidth = 0.012;
			for (const dx of [-0.05, 0, 0.05]) {
				ctx.beginPath();
				ctx.moveTo(side * 0.57 + dx + 0.015, 0.44);
				ctx.lineTo(side * 0.57 + dx - 0.015, 0.5);
				ctx.stroke();
			}
		}

		for (const side of [-1, 1]) {
			const cx = side * 0.4;
			const cy = 0.2;
			// Drawn at the size the numbers below read naturally, then enlarged about the eye's centre.
			ctx.save();
			ctx.translate(cx, cy);
			ctx.scale(1.16, 1.16);
			ctx.translate(-cx, -cy);
			if (eyesClosed) {
				ctx.strokeStyle = INK;
				ctx.lineWidth = 0.04;
				ctx.beginPath();
				ctx.moveTo(cx - 0.16, cy + 0.01);
				ctx.quadraticCurveTo(cx, cy + 0.09, cx + 0.16, cy + 0.01);
				ctx.stroke();
				ctx.restore();
				continue;
			}
			ctx.save();
			ctx.beginPath();
			ctx.ellipse(cx, cy, 0.165, 0.2, 0, 0, Math.PI * 2);
			ctx.clip();
			const iris = ctx.createLinearGradient(0, cy - 0.19, 0, cy + 0.19);
			iris.addColorStop(0, '#1f2a72');
			iris.addColorStop(0.55, '#3d5ccc');
			iris.addColorStop(1, '#8db4f5');
			ctx.fillStyle = iris;
			ctx.fillRect(cx - 0.2, cy - 0.2, 0.4, 0.4);
			// A lighter crescent low in the iris, the pupil, and a dark rim round the edge.
			ctx.fillStyle = 'rgba(176, 210, 255, 0.85)';
			ctx.beginPath();
			ctx.ellipse(cx, cy + 0.13, 0.11, 0.07, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#141a50';
			ctx.beginPath();
			ctx.ellipse(cx, cy - 0.01, 0.075, 0.105, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = '#1a2160';
			ctx.lineWidth = 0.025;
			ctx.beginPath();
			ctx.ellipse(cx, cy, 0.165, 0.2, 0, 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
			// Highlights, both on the same side like the 2D art.
			ctx.fillStyle = '#ffffff';
			ctx.beginPath();
			ctx.arc(cx + 0.055, cy - 0.08, 0.05, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(cx - 0.06, cy + 0.09, 0.022, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(cx + 0.075, cy + 0.06, 0.012, 0, Math.PI * 2);
			ctx.fill();
			// The heavy upper lash, with a little flick at the outer corner.
			ctx.strokeStyle = INK;
			ctx.lineWidth = 0.05;
			ctx.beginPath();
			ctx.ellipse(cx, cy + 0.01, 0.18, 0.215, 0, Math.PI * 1.12, Math.PI * 1.88);
			ctx.stroke();
			ctx.fillStyle = INK;
			ctx.beginPath();
			ctx.moveTo(cx + side * 0.12, cy - 0.15);
			ctx.lineTo(cx + side * 0.235, cy - 0.135);
			ctx.lineTo(cx + side * 0.17, cy - 0.04);
			ctx.fill();
			// A soft lower lash along the outer half.
			ctx.lineWidth = 0.016;
			ctx.beginPath();
			ctx.ellipse(cx, cy - 0.01, 0.17, 0.225, 0, Math.PI * (side > 0 ? 0.08 : 0.62), Math.PI * (side > 0 ? 0.38 : 0.92));
			ctx.stroke();
			ctx.restore();
		}

		// The ":3" mouth.
		ctx.strokeStyle = '#6b3a40';
		ctx.lineWidth = 0.02;
		ctx.beginPath();
		ctx.arc(-0.042, 0.46, 0.042, 0.1, Math.PI);
		ctx.moveTo(0.084, 0.46);
		ctx.arc(0.042, 0.46, 0.042, 0, Math.PI - 0.1);
		ctx.stroke();
	});
}

function snowflakeTexture() {
	return canvasTexture(256, 256, (ctx) => {
		ctx.translate(128, 128);
		ctx.strokeStyle = SNOW;
		ctx.lineCap = 'round';
		ctx.lineWidth = 16;
		for (let i = 0; i < 6; i++) {
			ctx.save();
			ctx.rotate((i * Math.PI) / 3);
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(0, -104);
			ctx.moveTo(0, -62);
			ctx.lineTo(-28, -88);
			ctx.moveTo(0, -62);
			ctx.lineTo(28, -88);
			ctx.stroke();
			ctx.restore();
		}
		ctx.fillStyle = NAVY;
		ctx.beginPath();
		ctx.arc(0, 0, 22, 0, Math.PI * 2);
		ctx.fill();
		ctx.lineWidth = 10;
		ctx.stroke();
	});
}

/** Spherical UVs around the head's centre, matching the equirectangular face painting. */
function faceUVs(geometry: THREE.BufferGeometry) {
	const pos = geometry.attributes.position;
	const uv = new Float32Array(pos.count * 2);
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i).normalize();
		const around = Math.atan2(v.x, v.z);
		uv[i * 2] = 0.25 + around / (Math.PI * 2);
		uv[i * 2 + 1] = 1 - Math.acos(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI;
	}
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** The looping clips baked into the model. Jump is separate: the page scrubs it along her flight. */
export type NixClip = 'Sit' | 'Idle' | 'Walk' | 'Run' | 'Wave';

export interface NixFigure {
	group: THREE.Group;
	/** Resolves once the model is in, or rejects if it could not be loaded. */
	ready: Promise<void>;
	setBlink(closed: boolean): void;
	/** Blend into a looping clip, played at `speed` times its natural pace. */
	play(clip: NixClip, speed?: number): void;
	/** `jump` is how far through a jump she is (0 → 1), or null on the ground. */
	tick(dt: number, time: number, state: { airborne: boolean; look: THREE.Vector2; still: boolean; jump: number | null }): void;
}

export function buildNixFigure(url: string): NixFigure {
	const ramp = toonRamp();
	// Toon shading plus a soft rim of light along the silhouette, so she lifts off the wall.
	const toon = (hex: string, extra: THREE.MeshToonMaterialParameters = {}) => {
		const mat = new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp, ...extra });
		mat.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <opaque_fragment>',
				`float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
				outgoingLight += smoothstep(0.45, 0.75, rim) * 0.22 * vec3(1.0, 0.97, 1.0);
				#include <opaque_fragment>`,
			);
		};
		return mat;
	};
	const openFace = faceTexture(false);
	const closedFace = faceTexture(true);
	// Her face keeps a gentler shadow than her clothes, so it never cuts across her cheeks.
	const faceMat = toon('#ffffff', { map: openFace, gradientMap: toonRamp([226, 244, 255]) });
	const materials: Record<string, THREE.Material> = {
		Navy: toon(NAVY),
		NavyDeep: toon(NAVY_DEEP),
		Hair: toon(HAIR, { side: THREE.DoubleSide }),
		Skin: toon(SKIN),
		Ink: toon(INK),
		Cord: toon('#f4f3ff'),
	};
	const snowMat = toon('#ffffff', { map: snowflakeTexture(), transparent: true, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2 });

	// The ink line: a back-facing twin of each mesh, pushed out along its normals.
	// Hair gets a finer lavender line, so the thin tips don't turn into black spikes.
	const inkLine = (hex: string, width: number) => {
		const line = new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide });
		line.onBeforeCompile = (shader) => {
			shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normal * ${width.toFixed(4)};`);
		};
		return line;
	};
	const outline = inkLine(INK, 0.012);
	const hairLine = inkLine('#8a85c4', 0.006);
	// Too fine to carry a line of their own.
	const uninked = /^(Cords|Pin)$|Laces$/;

	const group = new THREE.Group();
	let head: THREE.Object3D | null = null;
	let longHair: THREE.Object3D | null = null;
	let mixer: THREE.AnimationMixer | null = null;
	const actions = new Map<string, THREE.AnimationAction>();
	const weights = new Map<THREE.AnimationAction, number>();
	let clip: NixClip = 'Sit';
	const rest = { head: new THREE.Quaternion(), hair: new THREE.Quaternion() };

	const ready = new GLTFLoader().loadAsync(url).then((gltf) => {
		const model = gltf.scene;
		const meshes: THREE.Mesh[] = [];
		model.traverse((o) => {
			if (o instanceof THREE.Mesh) meshes.push(o);
		});
		for (const mesh of meshes) {
			// A multi-material object comes in as a group of meshes named after it.
			const owner = mesh.name || mesh.parent?.name || '';
			const placeholder = mesh.material as THREE.Material;
			if (owner.startsWith('Face')) {
				faceUVs(mesh.geometry);
				mesh.material = faceMat;
			} else {
				mesh.material = materials[placeholder.name] ?? materials.Navy;
			}
			placeholder.dispose();
			mesh.castShadow = true;
			if (uninked.test(owner)) continue;
			const lineMat = mesh.material === materials.Hair ? hairLine : outline;
			if (mesh instanceof THREE.SkinnedMesh) {
				// The hoodie and sleeves bend with the rig, so their ink line has to as well.
				const line = new THREE.SkinnedMesh(mesh.geometry, lineMat);
				line.bind(mesh.skeleton, mesh.bindMatrix);
				// Their bounds are measured standing in rest, which says little about where they are posed.
				mesh.frustumCulled = line.frustumCulled = false;
				mesh.add(line);
			} else {
				mesh.add(new THREE.Mesh(mesh.geometry, lineMat));
			}
		}
		for (const [name, size] of [
			['FlakeHat', 0.34],
			['FlakeChest', 0.22],
		] as const) {
			model.getObjectByName(name)?.add(new THREE.Mesh(new THREE.PlaneGeometry(size, size), snowMat));
		}
		// The rig's bones: the clips pose the body, and the page turns the head and long hair on top.
		head = model.getObjectByName('Head') ?? null;
		longHair = model.getObjectByName('Hair') ?? null;
		if (head) rest.head.copy(head.quaternion);
		if (longHair) rest.hair.copy(longHair.quaternion);
		mixer = new THREE.AnimationMixer(model);
		for (const animation of gltf.animations) {
			const action = mixer.clipAction(animation);
			if (animation.name === 'Jump') {
				action.setLoop(THREE.LoopOnce, 1);
				action.clampWhenFinished = true;
				action.paused = true;
			}
			action.play();
			action.setEffectiveWeight(0);
			actions.set(animation.name, action);
			weights.set(action, 0);
		}
		const sit = actions.get('Sit');
		if (sit) {
			sit.setEffectiveWeight(1);
			weights.set(sit, 1);
		}
		group.add(model);
	});

	let yaw = 0;
	let pitch = 0;
	let flow = 0;
	let jumpWeight = 0;
	const look = new THREE.Quaternion();
	const euler = new THREE.Euler();
	return {
		group,
		ready,
		setBlink(closed) {
			faceMat.map = closed ? closedFace : openFace;
		},
		play(next, speed = 1) {
			const playing = actions.get(next);
			if (playing) playing.timeScale = speed;
			if (next === clip) return;
			clip = next;
			// A clip that has faded right out starts again from the top, so a wave begins with the hand coming up.
			const action = actions.get(next);
			if (action && (weights.get(action) ?? 0) < 0.05) action.time = 0;
		},
		tick(dt, time, { airborne, look: pointer, still, jump }) {
			if (!head || !longHair || !mixer) return;
			const damp = (from: number, to: number, rate: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-rate * dt));
			// Every clip but Jump eases towards full or no weight; Jump cuts in quickly over the top of them.
			jumpWeight = damp(jumpWeight, jump === null ? 0 : 1, jump === null ? 8 : 18);
			const jumpAction = actions.get('Jump');
			for (const [name, action] of actions) {
				if (action === jumpAction) continue;
				const w = damp(weights.get(action) ?? 0, name === clip ? 1 : 0, 5);
				weights.set(action, w);
				action.setEffectiveWeight(w * (1 - jumpWeight));
			}
			if (jumpAction) {
				if (jump !== null) jumpAction.time = THREE.MathUtils.clamp(jump, 0, 1) * jumpAction.getClip().duration;
				jumpAction.setEffectiveWeight(jumpWeight);
			}
			mixer.update(still ? 0 : dt);

			// She glances towards the pointer, and her hair streams back when she runs or lifts in the air.
			yaw = damp(yaw, THREE.MathUtils.clamp(pointer.x, -1, 1) * 0.28, 4);
			pitch = damp(pitch, THREE.MathUtils.clamp(-pointer.y, -1, 1) * 0.12, 4);
			const stream = clip === 'Run' ? 0.3 : clip === 'Walk' ? 0.1 : 0;
			flow = damp(flow, airborne ? -0.2 : stream + (still ? 0 : Math.sin(time * 1.7) * 0.02), airborne ? 6 : 3);
			head.quaternion.copy(rest.head).multiply(look.setFromEuler(euler.set(pitch, yaw, still ? 0 : Math.sin(time * 0.8) * 0.03)));
			// The long hair hangs from her shoulders and is only half as stiff, so it trails a turn of the head.
			longHair.quaternion.copy(rest.hair).multiply(look.setFromEuler(euler.set(flow, yaw * 0.55, 0)));
		},
	};
}
