// The rift: a tear in the air, grey and slowly churning, with ragged edges. One hangs between the
// standing stones on the island (on a night after she's been to the top of Cloudrest) and leads to
// the grey place; one in the grey place leads back; and smaller ones open where a colour shard was
// taken, back to the Threshold. Colour seeps into it as the shards come home.
import * as THREE from 'three';

const VERTEX = /* glsl */ `
	varying vec2 vUv;
	#include <common>
	#include <fog_pars_vertex>
	void main() {
		vUv = uv;
		vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}
`;

const FRAGMENT = /* glsl */ `
	uniform float uTime;
	uniform float uOpen;
	uniform float uDark;
	uniform vec3 uTints[3];
	uniform float uTint;
	varying vec2 vUv;
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
		for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.07 + 3.1; a *= 0.5; }
		return v;
	}

	void main() {
		// -1 … 1 across, 0 … 1 up. The tear is widest a little below the middle and pinches to a
		// point at top and bottom, its edges ragged and creeping.
		float x = vUv.x * 2.0 - 1.0;
		float y = vUv.y;
		float width = pow(max(0.0, sin(3.14159 * y)), 0.7) * uOpen;
		float ragged = (fbm(vec2(y * 7.0, uTime * 0.4)) - 0.5) * 0.5 + (noise(vec2(y * 31.0, uTime * 1.3)) - 0.5) * 0.18;
		float edge = width * (0.82 + ragged) - abs(x + (fbm(vec2(y * 2.5, uTime * 0.15)) - 0.5) * 0.35);
		if (edge < 0.0) discard;

		// Inside: grey smoke turning over itself, pulled downwards and in towards the middle.
		vec2 p = vec2(x * 1.6, y * 3.0);
		float n = fbm(p * 1.4 + vec2(fbm(p + uTime * 0.12) * 2.0, -uTime * 0.35));
		float swirl = fbm(p * 3.0 - vec2(0.0, uTime * 0.6));
		float shade = mix(0.12, 0.92, smoothstep(0.25, 0.8, n));
		shade = mix(shade, 1.0 - shade, smoothstep(0.62, 0.8, swirl) * 0.6);
		vec3 col = vec3(shade);
		// Colour seeps in once some has come home: bands of it, drifting through the smoke.
		float band = fract(n * 2.0 + uTime * 0.05);
		vec3 tint = band < 0.333 ? uTints[0] : band < 0.666 ? uTints[1] : uTints[2];
		col = mix(col, tint * (0.5 + shade * 0.7), uTint * smoothstep(0.35, 0.75, n));
		// At night it's the darker parts that win; in the day, the paler.
		col = mix(col, col * col, uDark);
		// A bright rim, just inside the edge.
		float rim = 1.0 - smoothstep(0.0, 0.07, edge);
		col = mix(col, vec3(1.0), rim * 0.9);
		gl_FragColor = vec4(col, 1.0);
		#include <fog_fragment>
	}
`;

export interface Rift {
	mesh: THREE.Mesh;
	material: THREE.ShaderMaterial;
	update(time: number): void;
	/** How open it is, 0 (shut, invisible) … 1. */
	open: number;
	/** How much colour is in it, 0 … 1, and which colours. */
	tint(amount: number, colors: string[]): void;
	/** Darker at night. */
	night(on: boolean): void;
}

export function riftMaterial() {
	return new THREE.ShaderMaterial({
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uTime: { value: 0 },
			uOpen: { value: 1 },
			uDark: { value: 0 },
			uTint: { value: 0 },
			uTints: { value: [new THREE.Color('#ff7aa8'), new THREE.Color('#6fd0ff'), new THREE.Color('#ffd84d')] },
		},
		side: THREE.DoubleSide,
		fog: true,
	});
}

/** A rift `width` across and `height` tall, standing on y = 0, facing ±z. */
export function createRift(width: number, height: number, material = riftMaterial()): Rift {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
	mesh.position.y = height / 2;
	const u = material.uniforms;
	return {
		mesh,
		material,
		update(time) {
			u.uTime.value = time;
		},
		get open() {
			return u.uOpen.value;
		},
		set open(v: number) {
			u.uOpen.value = v;
			mesh.visible = v > 0.01;
		},
		tint(amount, colors) {
			u.uTint.value = amount;
			colors.slice(0, 3).forEach((c, i) => (u.uTints.value[i] as THREE.Color).set(c));
			for (let i = colors.length; i < 3; i++) (u.uTints.value[i] as THREE.Color).set(colors[0] ?? '#ffffff');
		},
		night(on) {
			u.uDark.value = on ? 0.6 : 0;
		},
	};
}
