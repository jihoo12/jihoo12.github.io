// The island's look: toon materials, and the little geometries its trees and rocks are made of.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TAU, noise } from './util';

/** Makes a toon material in the island's three-step shading. */
export type Toon = (params?: THREE.MeshToonMaterialParameters) => THREE.MeshToonMaterial;

function toonRamp(steps = [150, 215, 255]) {
	const ramp = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
	ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
	ramp.needsUpdate = true;
	return ramp;
}

export function makeToon(): Toon {
	const ramp = toonRamp();
	return (params = {}) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...params });
}

/** Bake one flat colour into a geometry, faceted, so pieces can be merged into one mesh. */
export function colored(geo: THREE.BufferGeometry, hex: string) {
	const g = geo.index ? geo.toNonIndexed() : geo;
	const c = new THREE.Color(hex);
	const n = g.attributes.position.count;
	const arr = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
	g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	g.deleteAttribute('uv');
	g.computeVertexNormals();
	return g;
}

export function palmGeometry() {
	const trunk = new THREE.CylinderGeometry(0.16, 0.27, 5, 7, 6);
	trunk.translate(0, 2.5, 0);
	const p = trunk.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const t = p.getY(i) / 5;
		p.setX(i, p.getX(i) + t * t * 1.1);
	}
	const parts = [colored(trunk, '#a7774e')];
	const top = new THREE.Vector3(1.1, 5, 0);
	for (let i = 0; i < 7; i++) {
		const frond = new THREE.BoxGeometry(0.75, 0.05, 2.7, 1, 1, 6);
		frond.translate(0, 0, 1.35);
		const fp = frond.attributes.position;
		for (let k = 0; k < fp.count; k++) {
			const t = fp.getZ(k) / 2.7;
			fp.setY(k, fp.getY(k) - t * t * 1.15);
			fp.setX(k, fp.getX(k) * (1 - t * 0.75));
		}
		frond.rotateX(-0.38);
		frond.rotateY((i * TAU) / 7 + 0.3);
		frond.translate(top.x, top.y, top.z);
		parts.push(colored(frond, i % 2 ? '#58b05a' : '#4a9e50'));
	}
	for (let i = 0; i < 3; i++) {
		const nut = new THREE.IcosahedronGeometry(0.17, 0);
		nut.translate(top.x + Math.cos(i * 2.1) * 0.22, top.y - 0.25, Math.sin(i * 2.1) * 0.22);
		parts.push(colored(nut, '#7a5236'));
	}
	return mergeGeometries(parts)!;
}

export function roundTreeGeometry() {
	const trunk = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
	trunk.translate(0, 1.2, 0);
	const blob = (r: number, x: number, y: number, z: number, hex: string) => {
		const g = new THREE.IcosahedronGeometry(r, 1);
		g.scale(1, 0.88, 1);
		g.translate(x, y, z);
		return colored(g, hex);
	};
	return mergeGeometries([
		colored(trunk, '#8a5a3c'),
		blob(1.55, 0, 3.3, 0, '#6cc26a'),
		blob(1.1, 0.7, 4.3, 0.25, '#7fd07a'),
		blob(1.0, -0.75, 3.85, -0.35, '#5db35f'),
	])!;
}

export function pineGeometry(snowy: boolean) {
	const trunk = new THREE.CylinderGeometry(0.14, 0.22, 1.4, 6);
	trunk.translate(0, 0.7, 0);
	const parts = [colored(trunk, '#7a5236')];
	[
		[1.5, 2.2, 1.9],
		[1.15, 1.9, 3.1],
		[0.75, 1.6, 4.2],
	].forEach(([r, h, y], i) => {
		const cone = new THREE.ConeGeometry(r, h, 7);
		cone.translate(0, y, 0);
		parts.push(colored(cone, snowy && i === 2 ? '#f6f5ff' : i % 2 ? '#3f8f62' : '#357f57'));
	});
	return mergeGeometries(parts)!;
}

export function rockGeometry() {
	const g = new THREE.IcosahedronGeometry(1, 1);
	const p = g.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < p.count; i++) {
		v.fromBufferAttribute(p, i);
		// Lumpy, but by position so the faces stay joined.
		v.multiplyScalar(0.9 + 0.12 * noise(v.x * 2.1 + 7, v.z * 2.1 + v.y * 3.3));
		p.setXYZ(i, v.x, v.y, v.z);
	}
	return colored(g, '#ffffff');
}

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	paint(canvas.getContext('2d')!);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

export const glowTexture = () =>
	canvasTexture(128, (ctx) => {
		const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
		g.addColorStop(0.35, 'rgba(220, 235, 255, 0.45)');
		g.addColorStop(1, 'rgba(200, 220, 255, 0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
	});
