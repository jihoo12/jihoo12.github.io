// The sea: one big plane whose colour comes from how deep the sea floor is beneath it, so the
// shallows glow turquoise and foam laps at the shore without any depth buffer tricks. And ripples
// that spread out on it wherever she swims or wades.
import * as THREE from 'three';
import { HALF, N, SIZE, STEP, heights } from './terrain';
import type { Theme } from './theme';

export function createWater(scene: THREE.Scene, fog: THREE.Fog, theme: Theme) {
	// Half floats, not bytes: a byte's 4 cm steps showed as wobbles in the surf on the flattest beaches.
	const data = new Uint16Array((N + 1) * (N + 1));
	for (let k = 0; k < data.length; k++) data[k] = THREE.DataUtils.toHalfFloat(heights[k]);
	const depthTex = new THREE.DataTexture(data, N + 1, N + 1, THREE.RedFormat, THREE.HalfFloatType);
	depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
	depthTex.needsUpdate = true;
	const waterMat = new THREE.ShaderMaterial({
		transparent: true,
		// Where the beach runs almost level with the sea the two would fight over every pixel; nudge
		// the water back a hair so the sand always wins there.
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 4,
		uniforms: {
			uTime: { value: 0 },
			uHeight: { value: depthTex },
			// The texel centres sit on the grid's vertices.
			uBounds: { value: new THREE.Vector3(-HALF - STEP / 2, -HALF - STEP / 2, SIZE + STEP) },
			uTexel: { value: 1 / (N + 1) },
			uStep: { value: STEP },
			uShallow: { value: new THREE.Color() },
			uDeep: { value: new THREE.Color() },
			uFoam: { value: new THREE.Color() },
			uFogColor: { value: fog.color },
			uFogNear: { value: fog.near },
			uFogFar: { value: fog.far },
		},
		vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
		fragmentShader: `
			uniform float uTime, uFogNear, uFogFar, uTexel, uStep; uniform sampler2D uHeight; uniform vec3 uBounds, uShallow, uDeep, uFoam, uFogColor;
			varying vec3 vWorld;
			void main() {
				vec2 uv = (vWorld.xz - uBounds.xy) / uBounds.z;
				float h = -6.0;
				if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) h = texture2D(uHeight, uv).r;
				float depth = max(-h, 0.0);
				float dist = distance(cameraPosition, vWorld);
				float w = sin(vWorld.x * 0.35 + uTime * 1.1) * sin(vWorld.z * 0.3 - uTime * 0.9) + 0.5 * sin((vWorld.x + vWorld.z) * 0.6 + uTime * 1.7);
				vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 4.5, depth));
				col += step(1.1, w) * 0.07 * (1.0 - smoothstep(30.0, 140.0, dist));
				// How steeply the sea floor shelves here, in metres down per metre out.
				vec2 dx = vec2(uTexel, 0.0), dz = vec2(0.0, uTexel);
				float slope = length(vec2(texture2D(uHeight, uv + dx).r - texture2D(uHeight, uv - dx).r, texture2D(uHeight, uv + dz).r - texture2D(uHeight, uv - dz).r)) / (2.0 * uStep);
				// A band of foam right at the water's edge, measured in depth scaled by the slope so it's
				// about half a metre wide and laps a few tens of centimetres whether the beach is steep or flat.
				float s = max(slope, 0.04);
				float foam = 1.0 - smoothstep(0.25 * s, 0.6 * s, depth + 0.2 * s * sin(uTime * 1.6 + vWorld.x * 0.2 + vWorld.z * 0.15));
				// Rings of it rolling in over the shallows. They follow the depth, so over a near-level
				// shelf a whole stretch of sea would flash white at once; keep them to where the sea
				// floor shelves enough to make lines.
				float ring = step(0.9, fract(depth * 2.2 - uTime * 0.35)) * (1.0 - smoothstep(0.2, 0.9, depth));
				ring *= smoothstep(0.05, 0.11, slope);
				foam = max(foam, ring * 0.7);
				col = mix(col, uFoam, foam);
				// The deep sea is opaque, so nothing shows past the edge of the sea floor.
				float alpha = max(mix(0.5, 1.0, smoothstep(0.0, 5.0, depth)), foam);
				col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
				alpha = mix(alpha, 1.0, smoothstep(uFogNear, uFogFar, dist));
				gl_FragColor = vec4(col, alpha);
				#include <colorspace_fragment>
			}`,
	});
	{
		const geo = new THREE.PlaneGeometry(4000, 4000);
		geo.rotateX(-Math.PI / 2);
		scene.add(new THREE.Mesh(geo, waterMat));
	}

	const ripples = Array.from({ length: 10 }, () => {
		const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
		const geo = new THREE.RingGeometry(0.82, 1, 40);
		geo.rotateX(-Math.PI / 2);
		const mesh = new THREE.Mesh(geo, mat);
		mesh.visible = false;
		mesh.renderOrder = 2;
		scene.add(mesh);
		return { mesh, mat, age: 0, size: 1 };
	});
	let nextRipple = 0;

	theme.on((p) => {
		waterMat.uniforms.uShallow.value.set(p.shallow);
		waterMat.uniforms.uDeep.value.set(p.deep);
		waterMat.uniforms.uFoam.value.set(p.foam);
		for (const r of ripples) r.mat.color.set(p.foam);
	});

	return {
		/** Starts a ring spreading on the water at (x, z): the sea, or water standing at `level`. */
		ripple(x: number, z: number, size: number, level = 0) {
			const r = ripples[nextRipple];
			nextRipple = (nextRipple + 1) % ripples.length;
			r.mesh.position.set(x, level + 0.04, z);
			r.mesh.visible = true;
			r.age = 0;
			r.size = size;
		},
		update(time: number, dt: number) {
			for (const r of ripples) {
				if (!r.mesh.visible) continue;
				r.age += dt;
				const t = r.age / 1.3;
				if (t >= 1) {
					r.mesh.visible = false;
					continue;
				}
				r.mesh.scale.setScalar(r.size * (0.6 + t * 2.2));
				r.mat.opacity = 0.75 * (1 - t) * (1 - t);
			}
			waterMat.uniforms.uTime.value = time;
		},
	};
}
