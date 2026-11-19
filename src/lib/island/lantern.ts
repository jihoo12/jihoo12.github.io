// The Grey Lantern, made at the forge from ashen ingots and sky shards: a little lantern that
// floats at Nixchan's shoulder, bobbing after her as she goes. By day it's only a lantern; after
// dark it lights the ground round her.
import * as THREE from 'three';
import { glowTexture, type Toon } from './look';
import type { Theme } from './theme';
import { damp } from '../nixkit/util';

export function createLantern(ctx: { scene: THREE.Scene; toon: Toon; theme: Theme; pos: THREE.Vector3; turn: () => number }) {
	const group = new THREE.Group();
	const frame = ctx.toon({ color: '#6e6e76' });
	const pale = ctx.toon({ color: '#d6d6dc' });
	const flame = new THREE.MeshBasicMaterial({ color: '#fff1b8' });
	group.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), flame));
	for (const [x, z] of [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	])
		group.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), frame).translateX(x * 0.12).translateZ(z * 0.12));
	group.add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 4), pale).translateY(0.21).rotateY(Math.PI / 4));
	group.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.28), frame).translateY(-0.15));
	const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff1b8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
	glow.scale.setScalar(1.6);
	group.add(glow);
	const light = new THREE.PointLight('#ffe7a8', 0, 14, 1.6);
	group.add(light);
	group.visible = false;
	ctx.scene.add(group);

	let night = false;
	ctx.theme.on((p) => (night = p.night));
	const at = ctx.pos.clone();
	let lit = 0;

	return {
		/** It's been made: from now on it's with her. */
		show() {
			group.visible = true;
			at.copy(ctx.pos);
		},
		update(time: number, dt: number) {
			if (!group.visible) return;
			// Over her left shoulder, a little behind, trailing after her as she moves.
			const t = ctx.turn();
			// (Out past the brim of her hat, so it's not hidden behind it from the camera.)
			const want = new THREE.Vector3(ctx.pos.x + Math.cos(t) * 0.85 - Math.sin(t) * 0.3, ctx.pos.y + 2.2 + Math.sin(time * 1.8) * 0.08, ctx.pos.z - Math.sin(t) * 0.85 - Math.cos(t) * 0.3);
			at.x = damp(at.x, want.x, 6, dt);
			at.y = damp(at.y, want.y, 6, dt);
			at.z = damp(at.z, want.z, 6, dt);
			group.position.copy(at);
			group.rotation.y = Math.sin(time * 0.7) * 0.3;
			lit = damp(lit, night ? 1 : 0, 2, dt);
			light.intensity = lit * (5 + Math.sin(time * 9) * 0.3);
			glow.material.opacity = 0.15 + lit * 0.55;
		},
	};
}
