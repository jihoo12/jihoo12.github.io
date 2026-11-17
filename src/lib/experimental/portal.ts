// The sky gate at the end of the path: a stone arch, built in Blender by tools/experimental-portal/build.py,
// with a swirl of sky in its opening. Walking Nixchan through it takes you to /island.
// Its origin is the middle of the opening on the ground; the opening faces +z (and -z: it works both ways).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The arch's size, as tools/experimental-portal/build.py builds it.
const PLINTH_TOP = 0.06;
const CENTRE_Y = 2.15;
const R_IN = 1.5;
const R_OUT = 2.02;
const DEPTH = 0.62;
const FOOT = THREE.MathUtils.degToRad(-38);
/** Half the width of the opening, between the arch's feet. */
export const PORTAL_HALF_WIDTH = R_IN * Math.cos(FOOT);
/** The plinth's radius, so nothing else stands on it. */
export const PORTAL_RADIUS = 3;
/** Each foot of the arch on the ground, in the gate's own frame: [x0, x1, z0, z1]. */
export const PORTAL_FEET: [number, number, number, number][] = [-1, 1].map((side) => {
	const a = PORTAL_HALF_WIDTH - 0.12;
	const b = R_OUT * Math.cos(FOOT) + 0.36;
	const half = DEPTH / 2 + 0.13;
	return side < 0 ? [-b, -a, -half, half] : [a, b, -half, half];
});

const VERTEX = /* glsl */ `
	varying vec2 vP;
	#include <common>
	#include <fog_pars_vertex>
	void main() {
		vP = position.xy;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const FRAGMENT = /* glsl */ `
	uniform float uTime;
	uniform float uNight;
	uniform float uSurge;
	uniform vec3 uDeep;
	uniform vec3 uSky;
	uniform vec3 uBlush;
	uniform vec3 uRim;
	varying vec2 vP;
	#include <common>
	#include <fog_pars_fragment>

	float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p), f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
	}
	float fbm(vec2 p) {
		float v = 0.0, a = 0.5;
		for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
		return v;
	}

	void main() {
		vec2 p = vP - vec2(0.0, ${CENTRE_Y.toFixed(3)});
		float r = length(p) / ${R_IN.toFixed(3)};
		// How far in from the edge of the opening: the arc above, the feet at the sides, the plinth below.
		float edge = min(${PORTAL_HALF_WIDTH.toFixed(3)} - abs(vP.x), vP.y - ${PLINTH_TOP.toFixed(3)});
		if (p.y > ${(R_IN * Math.sin(FOOT)).toFixed(3)}) edge = min(edge, ${R_IN.toFixed(3)} - length(p));

		// Clouds wound round into a whirl that turns slowly, tighter towards the middle.
		float spin = uTime * (0.35 + uSurge * 1.5) + 2.2 / (r + 0.45);
		float c = cos(spin), s = sin(spin);
		vec2 q = mat2(c, -s, s, c) * p;
		float n = fbm(q * 1.3 + vec2(0.0, uTime * 0.08));
		float wisps = smoothstep(0.5, 0.78, fbm(q * 2.4 - vec2(uTime * 0.05, 0.0)));

		vec3 col = mix(uDeep, uSky, smoothstep(0.15, 0.85, n + (1.0 - r) * 0.35));
		col = mix(col, uBlush, smoothstep(0.55, 0.9, n) * 0.6);
		col = mix(col, vec3(1.0), wisps * (0.55 - uNight * 0.3));
		// A bright eye in the middle, and a glowing rim.
		col += vec3(1.0, 0.97, 0.9) * pow(max(0.0, 1.0 - r), 3.0) * (0.55 + uSurge * 1.5);
		col = mix(col, uRim, smoothstep(0.32, 0.0, edge) * 0.85);
		// Stars twinkle in it by night.
		vec2 cell = floor(q * 9.0);
		float star = step(0.93, hash(cell)) * smoothstep(0.12, 0.0, length(fract(q * 9.0) - 0.5));
		col += star * uNight * (0.6 + 0.4 * sin(uTime * 3.0 + hash(cell) * 30.0));
		col = mix(col, vec3(1.0), uSurge * 0.5);

		gl_FragColor = vec4(col, 1.0);
		#include <colorspace_fragment>
		#include <fog_fragment>
	}
`;

export interface Portal {
	group: THREE.Group;
	/** What the pointer picks: the arch and its opening. */
	pickable: THREE.Object3D;
	ready: Promise<void>;
	/** Turn the palette to day or night. */
	theme(night: boolean): void;
	/** 0 → 1 as someone goes through, and the whirl spins up and brightens. */
	surge: number;
	tick(time: number): void;
}

export function buildPortal(url: string, reduceMotion: boolean): Portal {
	const group = new THREE.Group();
	const pickable = new THREE.Group();
	group.add(pickable);

	const veilMat = new THREE.ShaderMaterial({
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		side: THREE.DoubleSide,
		fog: true,
		uniforms: THREE.UniformsUtils.merge([
			THREE.UniformsLib.fog,
			{
				uTime: { value: 0 },
				uNight: { value: 0 },
				uSurge: { value: 0 },
				uDeep: { value: new THREE.Color() },
				uSky: { value: new THREE.Color() },
				uBlush: { value: new THREE.Color() },
				uRim: { value: new THREE.Color() },
			},
		]),
	});
	const glowMat = new THREE.MeshBasicMaterial({ color: '#bfeeff' });

	// A soft light spilling out of the opening, which shows by night.
	const light = new THREE.PointLight('#9fdcff', 0, 9, 1.5);
	light.position.set(0, CENTRE_Y, 1.2);
	group.add(light);

	// Motes of light drifting in from round about and swallowed by the whirl.
	const MOTES = 18;
	const motes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4), glowMat, MOTES);
	motes.frustumCulled = false;
	group.add(motes);
	const moteSeeds = Array.from({ length: MOTES }, (_, i) => ({ phase: i / MOTES, angle: i * 2.39996, side: i % 2 ? 1 : -1 }));
	const place = new THREE.Object3D();

	const floats: { mesh: THREE.Object3D; base: THREE.Vector3; phase: number }[] = [];
	const FLOAT_AT = [new THREE.Vector3(-2.75, 3.4, 0.35), new THREE.Vector3(2.8, 3.95, -0.25), new THREE.Vector3(0.75, 4.75, 0.55)];

	let lit = false;
	const ready = new GLTFLoader().loadAsync(url).then((gltf) => {
		const cache = new Map<string, THREE.Material>();
		gltf.scene.traverse((child) => {
			const mesh = child as THREE.Mesh;
			if (!mesh.isMesh) return;
			if (mesh.name.startsWith('Veil')) {
				mesh.material = veilMat;
				return;
			}
			const swap = (m: THREE.Material) => {
				const std = m as THREE.MeshStandardMaterial;
				if (std.name === 'Glow') return glowMat;
				const key = std.color.getHexString();
				let mat = cache.get(key);
				if (!mat) cache.set(key, (mat = new THREE.MeshLambertMaterial({ color: std.color })));
				return mat;
			};
			mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
			mesh.castShadow = mesh.receiveShadow = true;
		});
		for (const name of ['Gate', 'Veil']) {
			const part = gltf.scene.getObjectByName(name);
			if (part) pickable.add(part);
		}
		FLOAT_AT.forEach((base, i) => {
			const mesh = gltf.scene.getObjectByName(`Float${i}`);
			if (!mesh) return;
			mesh.position.copy(base);
			group.add(mesh);
			floats.push({ mesh, base, phase: i * 2.1 });
		});
	});

	return {
		group,
		pickable,
		ready,
		surge: 0,
		theme(night) {
			const u = veilMat.uniforms;
			u.uNight.value = night ? 1 : 0;
			u.uDeep.value.set(night ? '#2a2f7a' : '#6fb6f2');
			u.uSky.value.set(night ? '#6a63c9' : '#bfe6ff');
			u.uBlush.value.set(night ? '#c48ae6' : '#ffc9e3');
			u.uRim.value.set(night ? '#c9f2ff' : '#ffffff');
			glowMat.color.set(night ? '#c9f6ff' : '#e6fbff');
			lit = night;
		},
		tick(time) {
			const t = reduceMotion ? 0 : time;
			veilMat.uniforms.uTime.value = t;
			veilMat.uniforms.uSurge.value = this.surge;
			light.intensity = (lit ? 14 : 0) + this.surge * 30;
			for (const f of floats) {
				f.mesh.position.set(f.base.x, f.base.y + Math.sin(t * 0.9 + f.phase) * 0.18, f.base.z);
				f.mesh.rotation.y = t * 0.25 + f.phase;
			}
			moteSeeds.forEach((m, i) => {
				// Each one spirals in from a couple of metres out to the middle of the opening, then starts again.
				const k = (m.phase + t * (0.12 + this.surge * 0.6)) % 1;
				const r = (1 - k) * 2.6 + 0.1;
				const a = m.angle + k * 5 * m.side;
				place.position.set(Math.cos(a) * r * 0.9, CENTRE_Y + Math.sin(a) * r * 0.75, (1 - k) * 1.4 * m.side);
				const size = Math.sin(Math.PI * k) * (reduceMotion ? 0 : 1);
				place.scale.setScalar(size);
				place.updateMatrix();
				motes.setMatrixAt(i, place.matrix);
			});
			motes.instanceMatrix.needsUpdate = true;
		},
	};
}
