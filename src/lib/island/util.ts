// Small maths shared across the island: easing, seeded randomness and smooth noise.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = THREE.MathUtils.clamp;
export const smoothstep = (e0: number, e1: number, x: number) => {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};
/** Eases `from` towards `to` at `rate`, the same whatever the frame rate. */
export const damp = (from: number, to: number, rate: number, dt: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-rate * dt));

/** A seeded random number generator, 0 … 1. */
export function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function lattice(ix: number, iy: number) {
	let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in -1 … 1. */
export function noise(x: number, y: number) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const a = lattice(ix, iy);
	const b = lattice(ix + 1, iy);
	const c = lattice(ix, iy + 1);
	const d = lattice(ix + 1, iy + 1);
	return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x: number, y: number, octaves: number) {
	let sum = 0;
	let amp = 0.5;
	let freq = 1;
	for (let i = 0; i < octaves; i++) {
		sum += amp * noise(x * freq, y * freq);
		freq *= 2.03;
		amp *= 0.5;
	}
	return sum;
}
