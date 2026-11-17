// The camera swings round behind her, and never dips under the ground or the sea. Under the
// glider it hangs back a little, to show more of where she's heading. Given a `chat` (someone
// she's talking to), it swings round to the side and closes in, to show the two of them.
import * as THREE from 'three';
import type { Orbit } from './controls';
import { groundAt, nearby, type Feature } from './features';
import { damp } from './util';

export function createFollowCamera(camera: THREE.PerspectiveCamera, orbit: Orbit, start: THREE.Vector3) {
	const camLook = start.clone();
	camLook.y += 1.2;
	const camPos = new THREE.Vector3();
	let camReach = 9;
	const orbitDir = new THREE.Vector3();

	return {
		update(dt: number, her: { pos: THREE.Vector3; gliderOpen: number }, chat: { x: number; z: number; facing: number } | null) {
			const { pos } = her;
			if (chat) {
				const want = chat.facing + Math.PI + 0.9;
				orbit.yaw += Math.atan2(Math.sin(want - orbit.yaw), Math.cos(want - orbit.yaw)) * (1 - Math.exp(-3 * dt));
				orbit.pitch = damp(orbit.pitch, 0.22, 3, dt);
				orbit.distance = damp(orbit.distance, 5.5, 3, dt);
			}
			camLook.x = damp(camLook.x, chat ? THREE.MathUtils.lerp(pos.x, chat.x, 0.45) : pos.x, chat ? 4 : 10, dt);
			camLook.y = damp(camLook.y, pos.y + 1.2, 6, dt);
			camLook.z = damp(camLook.z, chat ? THREE.MathUtils.lerp(pos.z, chat.z, 0.45) : pos.z, chat ? 4 : 10, dt);
			orbitDir.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch));
			// If a tree's leaves come between her and the camera, it closes in in front of them (quickly)
			// rather than sitting inside them, and eases back out once they're past.
			const wantDistance = orbit.distance * (1 + her.gliderOpen * 0.35);
			let clear = wantDistance;
			const checked = new Set<Feature>();
			for (let t = 0; t <= wantDistance + 2; t += 1) {
				for (const f of nearby(camLook.x + orbitDir.x * t, camLook.z + orbitDir.z * t)) {
					const c = f.crown;
					if (!c || checked.has(f)) continue;
					checked.add(f);
					const ox = camLook.x - c.x;
					const oy = camLook.y - c.y;
					const oz = camLook.z - c.z;
					const r = c.r + 0.6;
					const b = ox * orbitDir.x + oy * orbitDir.y + oz * orbitDir.z;
					const inside = ox * ox + oy * oy + oz * oz - r * r;
					// (When she's in among the leaves herself there's nowhere better to be, so leave it.)
					if (inside < 0 || b * b - inside < 0) continue;
					const hit = -b - Math.sqrt(b * b - inside);
					if (hit > 0) clear = Math.min(clear, hit);
				}
			}
			camReach = clear < camReach ? damp(camReach, clear, 7, dt) : damp(camReach, clear, 1.8, dt);
			camPos.copy(camLook).addScaledVector(orbitDir, Math.max(Math.min(camReach, wantDistance), 1.5));
			// Up on the sky island it keeps above the island's grass too (asked from her height, since
			// the camera may have dipped below the grass it's being kept above).
			camPos.y = Math.max(camPos.y, groundAt(camPos.x, camPos.z, Math.max(camPos.y, camLook.y)) + 0.7, 0.6);
			camera.position.copy(camPos);
			camera.lookAt(camLook);
		},
	};
}
