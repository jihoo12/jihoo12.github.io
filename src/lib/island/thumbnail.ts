// Little pictures of 3D things for the island's menus (a fish in the bag, a turnip at the market),
// drawn once with the page's own renderer into an offscreen target and kept as an image URL.
import * as THREE from 'three';

const SIZE = 128;

/** A picture of `object`, framed to fit, seen from `from` (a direction towards the camera). */
export function thumbnail(renderer: THREE.WebGLRenderer, object: THREE.Object3D, from = new THREE.Vector3(1, 0.2, 0)): string {
	const stage = new THREE.Scene();
	const key = new THREE.DirectionalLight('#ffffff', 2.2);
	key.position.set(1, 2, 3);
	stage.add(new THREE.AmbientLight('#ffffff', 1.4), key, object);
	const box = new THREE.Box3().setFromObject(object);
	const centre = box.getCenter(new THREE.Vector3());
	const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
	const span = radius * 0.95;
	const camera = new THREE.OrthographicCamera(-span, span, span, -span, 0.01, radius * 10);
	camera.position.copy(centre).addScaledVector(from.clone().normalize(), radius * 3);
	camera.lookAt(centre);

	const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
	target.texture.colorSpace = THREE.SRGBColorSpace;
	const before = renderer.getRenderTarget();
	const clear = renderer.getClearColor(new THREE.Color());
	const alpha = renderer.getClearAlpha();
	renderer.setRenderTarget(target);
	renderer.setClearColor(0x000000, 0);
	renderer.clear();
	renderer.render(stage, camera);
	const pixels = new Uint8Array(SIZE * SIZE * 4);
	renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
	renderer.setRenderTarget(before);
	renderer.setClearColor(clear, alpha);
	target.dispose();
	object.removeFromParent();

	// The render target is upside down to a canvas.
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const c2d = canvas.getContext('2d')!;
	const img = c2d.createImageData(SIZE, SIZE);
	for (let y = 0; y < SIZE; y++) img.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
	c2d.putImageData(img, 0, 0);
	return canvas.toDataURL('image/png');
}
