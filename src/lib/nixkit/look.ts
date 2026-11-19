// The Nixkit look: toon materials in three-step shading, and a few helpers for building flat-coloured
// geometry and glowing sprites. Every world made with Nixkit shares it, so Nixchan fits in anywhere.
import * as THREE from 'three';

/** Makes a toon material in the three-step shading. */
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
