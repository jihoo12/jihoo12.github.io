// Nixchan breaking the fourth wall, after talking with Parmen on the islet (tortoise.ts). She turns
// round to face whoever's watching, says hello, and knocks on the inside of the screen three times;
// each knock cracks it further, from where her knuckles meet the glass. Then it shatters: the shards
// (pieces of the very last frame) fall away, there's sky behind, and she's out on /experimental,
// where the page fades in from that same sky.
//
// The cracks and the shards are cut along the same lines: rays out from the knock, crossed by rings
// at a few distances. A shard is the piece between two neighbouring rays and two neighbouring rings.
import * as THREE from 'three';

export interface WallContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.Camera;
	/** Nixchan says something, in a bubble over her head. */
	say: (text: string) => void;
	/** Nixchan's knock (her wave). */
	knock: () => void;
	/** Where she's going. */
	to: string;
}

const RAYS = 12;

export function createFourthWall(ctx: WallContext) {
	let breaking = false;
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

	const go = () => {
		if (breaking) return;
		breaking = true;
		const canvas = ctx.renderer.domElement;
		const w = innerWidth;
		const h = innerHeight;
		// The knock lands a little above the middle, about where her hand meets the glass.
		const cx = w / 2;
		const cy = h * 0.46;
		const far = Math.hypot(w, h);
		const rings = [0, Math.min(w, h) * 0.07, Math.min(w, h) * 0.2, Math.min(w, h) * 0.42, far];
		const angles = Array.from({ length: RAYS }, (_, i) => ((i + 0.5 + (Math.random() - 0.5) * 0.7) / RAYS) * Math.PI * 2);
		// Where each ray crosses each ring, a little off true, so the cracks are jagged.
		const at = angles.map((a) =>
			rings.map((r, k) => {
				const wob = k === 0 || k === rings.length - 1 ? 0 : (Math.random() - 0.5) * 0.25;
				const rr = r * (1 + (k && k < rings.length - 1 ? (Math.random() - 0.5) * 0.25 : 0));
				return [cx + Math.cos(a + wob) * rr, cy + Math.sin(a + wob) * rr] as const;
			}),
		);

		// The glass: an SVG over the canvas that the cracks are drawn into, knock by knock.
		const NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
		svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:70;pointer-events:none';
		document.body.append(svg);
		const line = (pts: (readonly [number, number])[]) => {
			const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
			for (const [stroke, width] of [
				['rgba(29,27,58,0.55)', 4],
				['rgba(255,255,255,0.95)', 1.6],
			] as const) {
				const path = document.createElementNS(NS, 'path');
				path.setAttribute('d', d);
				path.setAttribute('fill', 'none');
				path.setAttribute('stroke', stroke);
				path.setAttribute('stroke-width', String(width));
				path.setAttribute('stroke-linejoin', 'round');
				svg.append(path);
			}
		};
		/** Cracks out to ring `k`: the rays as far as it, and the ring itself between them (some of it). */
		const crackTo = (k: number) => {
			for (let i = 0; i < RAYS; i++) line([at[i][k - 1], at[i][k]]);
			if (k < rings.length - 1) for (let i = 0; i < RAYS; i++) if (Math.random() < 0.75) line([at[i][k], at[(i + 1) % RAYS][k]]);
		};
		const shake = (strength: number) => {
			if (reduceMotion) return;
			canvas.animate(
				[0, 1, 2, 3, 4].map((i) => ({ transform: i === 4 ? 'none' : `translate(${(Math.random() - 0.5) * strength}px, ${(Math.random() - 0.5) * strength}px)` })),
				{ duration: 220 },
			);
		};

		const steps: [number, () => void][] = [
			[400, () => ctx.say('Hello? Is somebody there?')],
			[1900, () => (ctx.knock(), shake(6), crackTo(1))],
			[2700, () => (ctx.knock(), shake(10), crackTo(2))],
			[3600, () => (ctx.knock(), shake(16), crackTo(3))],
			[4500, shatter],
		];
		for (const [ms, run] of steps) setTimeout(run, ms);

		function shatter() {
			// The frame as it is now, to cut the shards from (read straight after drawing it, before
			// the canvas is cleared for the next).
			ctx.renderer.render(ctx.scene, ctx.camera);
			const shot = canvas.toDataURL('image/jpeg', 0.85);
			const sky = document.createElement('div');
			const night = document.documentElement.dataset.time === 'night';
			sky.style.cssText = `position:fixed;inset:0;z-index:68;background:${
				night
					? 'radial-gradient(circle at 50% 55%, #f4f0ff 0%, #a9a0ec 40%, #4f4aa8 80%, #2a2f7a 100%)'
					: 'radial-gradient(circle at 50% 55%, #fffdf6 0%, #d8f0ff 35%, #9fd0f5 75%, #7db7ea 100%)'
			}`;
			const shards = document.createElement('div');
			shards.style.cssText = 'position:fixed;inset:0;z-index:69;pointer-events:none';
			for (let i = 0; i < RAYS; i++) {
				for (let k = 0; k < rings.length - 1; k++) {
					const poly = [at[i][k], at[i][k + 1], at[(i + 1) % RAYS][k + 1], at[(i + 1) % RAYS][k]];
					const piece = document.createElement('div');
					piece.style.cssText = `position:absolute;inset:0;background:url(${shot}) center/100% 100%;clip-path:polygon(${poly.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
					shards.append(piece);
					if (reduceMotion) continue;
					// Out from the knock and down, turning as it goes; the middle goes first.
					const [mx, my] = poly.reduce(([sx, sy], [x, y]) => [sx + x / 4, sy + y / 4], [0, 0]);
					const out = Math.hypot(mx - cx, my - cy) || 1;
					const push = 60 + Math.random() * 120;
					const dx = ((mx - cx) / out) * push;
					const dy = ((my - cy) / out) * push * 0.6 + h * (0.7 + Math.random() * 0.5);
					const spin = (Math.random() - 0.5) * 70;
					piece.style.transformOrigin = `${mx}px ${my}px`;
					piece.animate(
						[{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(0.9)`, opacity: 0.85 }],
						{ duration: 1100 + Math.random() * 500, delay: k * 90 + Math.random() * 120, easing: 'cubic-bezier(.45,0,.9,.6)', fill: 'forwards' },
					);
				}
			}
			document.body.append(sky, shards);
			svg.remove();
			canvas.style.visibility = 'hidden';
			setTimeout(() => location.assign(ctx.to), reduceMotion ? 600 : 1700);
		}
	};

	// Coming back with the browser's back button brings the page back as it was left: undo it all.
	addEventListener('pageshow', (e) => {
		if (e.persisted && breaking) location.reload();
	});

	return {
		go,
		/** While it's happening, she stands still facing out, and the keys do nothing. */
		get breaking() {
			return breaking;
		},
	};
}
