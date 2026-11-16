// The 3D Nixchan figure for the experimental homepage. The model is built in Blender by
// tools/nixchan-3d/build.py; this file dresses it in toon shading with an inked outline, paints
// her face on, and animates the empties the script leaves for it.
// Her origin is where she sits: y = 0 is the surface, z = 0 is its front edge, and she faces +z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const NAVY = '#2c2a52';
const NAVY_DEEP = '#22203f';
const HAIR = '#eceafc';
const SKIN = '#fde9df';
const SNOW = '#5f9be8';
const INK = '#1d1b3a';


function toonRamp() {
	const data = new Uint8Array([150, 215, 255]);
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
			const blush = ctx.createRadialGradient(side * 0.6, 0.36, 0, side * 0.6, 0.36, 0.14);
			blush.addColorStop(0, 'rgba(244, 146, 158, 0.6)');
			blush.addColorStop(1, 'rgba(244, 146, 158, 0)');
			ctx.fillStyle = blush;
			ctx.beginPath();
			ctx.ellipse(side * 0.6, 0.36, 0.15, 0.09, 0, 0, Math.PI * 2);
			ctx.fill();
			// The little hatch lines over the blush.
			ctx.strokeStyle = 'rgba(226, 112, 128, 0.75)';
			ctx.lineWidth = 0.012;
			for (const dx of [-0.05, 0, 0.05]) {
				ctx.beginPath();
				ctx.moveTo(side * 0.6 + dx + 0.015, 0.33);
				ctx.lineTo(side * 0.6 + dx - 0.015, 0.39);
				ctx.stroke();
			}
		}

		for (const side of [-1, 1]) {
			const cx = side * 0.38;
			const cy = 0.18;
			if (eyesClosed) {
				ctx.strokeStyle = INK;
				ctx.lineWidth = 0.04;
				ctx.beginPath();
				ctx.moveTo(cx - 0.16, 0.19);
				ctx.quadraticCurveTo(cx, 0.27, cx + 0.16, 0.19);
				ctx.stroke();
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
			ctx.beginPath();
			ctx.moveTo(cx + side * 0.15, cy - 0.08);
			ctx.lineTo(cx + side * 0.21, cy - 0.11);
			ctx.stroke();
			// A soft lower lash along the outer half.
			ctx.lineWidth = 0.016;
			ctx.beginPath();
			ctx.ellipse(cx, cy - 0.01, 0.17, 0.225, 0, Math.PI * (side > 0 ? 0.08 : 0.62), Math.PI * (side > 0 ? 0.38 : 0.92));
			ctx.stroke();
		}

		// The ":3" mouth.
		ctx.strokeStyle = '#6b3a40';
		ctx.lineWidth = 0.02;
		ctx.beginPath();
		ctx.arc(-0.042, 0.41, 0.042, 0.1, Math.PI);
		ctx.moveTo(0.084, 0.41);
		ctx.arc(0.042, 0.41, 0.042, 0, Math.PI - 0.1);
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

export interface NixFigure {
	group: THREE.Group;
	/** Resolves once the model is in, or rejects if it could not be loaded. */
	ready: Promise<void>;
	setBlink(closed: boolean): void;
	tick(dt: number, time: number, state: { airborne: boolean; look: THREE.Vector2; still: boolean }): void;
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
	const faceMat = toon('#ffffff', { map: openFace });
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
	const uninked = new Set(['Cords', 'Pin']);

	const group = new THREE.Group();
	let head: THREE.Object3D | null = null;
	let longHair: THREE.Object3D | null = null;
	let knees: THREE.Object3D[] = [];
	const rest = { head: new THREE.Vector3(), hair: new THREE.Vector3() };

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
			if (!uninked.has(owner)) mesh.add(new THREE.Mesh(mesh.geometry, mesh.material === materials.Hair ? hairLine : outline));
		}
		for (const [name, size] of [
			['FlakeHat', 0.34],
			['FlakeChest', 0.22],
		] as const) {
			model.getObjectByName(name)?.add(new THREE.Mesh(new THREE.PlaneGeometry(size, size), snowMat));
		}
		head = model.getObjectByName('HeadPivot') ?? null;
		longHair = model.getObjectByName('LongHair') ?? null;
		knees = ['KneeL', 'KneeR'].map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
		if (head) rest.head.copy(head.position);
		if (longHair) rest.hair.copy(longHair.position);
		group.add(model);
	});

	let yaw = 0;
	let pitch = 0;
	let flow = 0;
	return {
		group,
		ready,
		setBlink(closed) {
			faceMat.map = closed ? closedFace : openFace;
		},
		tick(dt, time, { airborne, look, still }) {
			if (!head || !longHair) return;
			const damp = (from: number, to: number, rate: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-rate * dt));
			// She glances towards the pointer, and her hair lifts while she is in the air.
			yaw = damp(yaw, THREE.MathUtils.clamp(look.x, -1, 1) * 0.28, 4);
			pitch = damp(pitch, THREE.MathUtils.clamp(-look.y, -1, 1) * 0.12, 4);
			flow = damp(flow, airborne ? -0.2 : 0, airborne ? 6 : 3);
			const bob = still ? 0 : Math.sin(time * 1.7) * 0.012;
			head.rotation.set(pitch, yaw, still ? 0 : Math.sin(time * 0.8) * 0.03);
			head.position.y = rest.head.y + bob;
			// The long hair hangs from the head but is only half as stiff, so it trails a turn.
			longHair.rotation.set(flow, yaw * 0.55, 0);
			longHair.position.y = rest.hair.y + bob;
			knees.forEach((knee, i) => {
				const swing = still ? 0 : Math.sin(time * 2.6 + i * Math.PI) * 0.28 - 0.08;
				knee.rotation.x = damp(knee.rotation.x, airborne ? 0.75 - i * 0.2 : swing, 10);
			});
		},
	};
}
