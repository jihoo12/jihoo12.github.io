// Exploring: the places she comes across (a banner greets her at each, "New place found" the first
// time), and the maps, uncovered as she goes and remembered between visits. The minimap follows her
// about; the big map, in the menu, shows the whole sea with the names of the places she's found.
import * as THREE from 'three';
import type { Place } from './layout';
import { loadJSON, loadText, saveJSON, saveText } from './save';
import { skyTopAt } from './skyisle';
import { WORLD_EDGE, deckAt, terrainAt } from './terrain';
import { clamp } from './util';

export interface ExploreUi {
	banner: HTMLElement | null;
	bannerName: HTMLElement | null;
	bannerNote: HTMLElement | null;
	map: HTMLCanvasElement | null;
	atlasMap: HTMLCanvasElement | null;
	atlasCount: HTMLElement | null;
}

// Both maps are drawn from one picture of the whole sea, uncovered as she explores it.
const MAP_SPAN = WORLD_EDGE;
const MAP_PX = 384;
const toPx = (v: number) => ((v / MAP_SPAN) * 0.5 + 0.5) * MAP_PX;
const FOG = '#d6dbe9';
/** The minimap shows the 80 m or so round her. */
const VIEW = 40;

export function createExplore(ui: ExploreUi, places: Place[]) {
	// ---------- coming across places ----------

	const discovered = new Set<string>();
	{
		const saved = loadJSON('places');
		if (Array.isArray(saved)) for (const id of saved) if (places.some((p) => p.id === id)) discovered.add(id);
	}
	let bannerTimer = 0;
	const announce = (name: string, note: string | null) => {
		if (!ui.banner || !ui.bannerName || !ui.bannerNote) return;
		ui.bannerName.textContent = name;
		ui.bannerNote.textContent = note ?? '';
		ui.bannerNote.hidden = !note;
		ui.banner.classList.remove('show');
		void ui.banner.offsetWidth;
		ui.banner.classList.add('show');
		clearTimeout(bannerTimer);
		bannerTimer = window.setTimeout(() => ui.banner?.classList.remove('show'), 3600);
	};
	const updateCount = () => {
		if (!ui.atlasCount) return;
		const left = places.length - discovered.size;
		ui.atlasCount.textContent =
			left === 0 ? `You've been everywhere on the map. Go wherever you like!` : `${discovered.size} of ${places.length} places found. Some are out at sea.`;
	};
	updateCount();
	let here: Place | null = null;
	const checkPlaces = (pos: THREE.Vector3) => {
		// She has to wander off a little way before the same place greets her again.
		if (here && (Math.hypot(pos.x - here.x, pos.z - here.z) > here.r * 1.5 + 3 || (here.above !== undefined && pos.y < here.above - 6))) here = null;
		if (here) return;
		for (const p of places) {
			if (Math.hypot(pos.x - p.x, pos.z - p.z) > p.r || (p.above !== undefined && pos.y < p.above)) continue;
			here = p;
			const first = !discovered.has(p.id);
			if (first) {
				discovered.add(p.id);
				saveJSON('places', [...discovered]);
			}
			announce(p.name, first ? 'New place found' : null);
			updateCount();
			break;
		}
	};

	// ---------- the maps ----------

	const mapImage = (() => {
		const c = document.createElement('canvas');
		c.width = c.height = MAP_PX;
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(MAP_PX, MAP_PX);
		for (let y = 0; y < MAP_PX; y++)
			for (let x = 0; x < MAP_PX; x++) {
				const wx = ((x + 0.5) / MAP_PX - 0.5) * 2 * MAP_SPAN;
				const wz = ((y + 0.5) / MAP_PX - 0.5) * 2 * MAP_SPAN;
				const h = Math.max(terrainAt(wx, wz), deckAt(wx, wz));
				// The sky island is drawn over what's under it, paler, as seen from above.
				const sky = skyTopAt(wx, wz);
				const rgb = sky !== null ? [176, 226, 150] : h < 0 ? (h > -1.2 ? [134, 227, 214] : h > -4 ? [92, 170, 222] : [58, 134, 208]) : h < 1.5 ? [244, 226, 174] : h > 14.5 ? [246, 245, 255] : [136, 204, 115 - Math.min(h, 12) * 3];
				img.data.set([...rgb, 255], (y * MAP_PX + x) * 4);
			}
		ctx.putImageData(img, 0, 0);
		return c;
	})();
	const makeCanvas = () => {
		const c = document.createElement('canvas');
		c.width = c.height = MAP_PX;
		return [c, c.getContext('2d')!] as const;
	};
	const [mask, maskCtx] = makeCanvas();
	const [shown, shownCtx] = makeCanvas();
	const refreshShown = () => {
		shownCtx.globalCompositeOperation = 'source-over';
		shownCtx.clearRect(0, 0, MAP_PX, MAP_PX);
		shownCtx.drawImage(mapImage, 0, 0);
		shownCtx.globalCompositeOperation = 'destination-in';
		shownCtx.drawImage(mask, 0, 0);
		shownCtx.globalCompositeOperation = 'source-over';
	};
	let maskDirty = false;
	{
		const saved = loadText('map');
		if (saved?.startsWith('data:image/png')) {
			const img = new Image();
			img.onload = () => {
				maskCtx.drawImage(img, 0, 0);
				refreshShown();
			};
			img.src = saved;
		}
	}
	const revealedAt = new THREE.Vector2(Infinity, Infinity);
	const reveal = (pos: THREE.Vector3) => {
		if (revealedAt.distanceTo(new THREE.Vector2(pos.x, pos.z)) < 2) return;
		revealedAt.set(pos.x, pos.z);
		// She sees further from high up.
		const metres = 22 + Math.max(0, pos.y) * 1.4;
		const r = (metres / MAP_SPAN) * 0.5 * MAP_PX;
		const cx = toPx(pos.x);
		const cy = toPx(pos.z);
		const g = maskCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
		g.addColorStop(0, 'rgba(0, 0, 0, 1)');
		g.addColorStop(0.55, 'rgba(0, 0, 0, 1)');
		g.addColorStop(1, 'rgba(0, 0, 0, 0)');
		maskCtx.fillStyle = g;
		maskCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
		refreshShown();
		maskDirty = true;
	};
	const saveMap = () => {
		if (!maskDirty) return;
		maskDirty = false;
		saveText('map', mask.toDataURL('image/png'));
	};
	setInterval(saveMap, 5000);
	addEventListener('pagehide', saveMap);

	const drawArrow = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, turn: number) => {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(-turn);
		ctx.fillStyle = '#2c2a52';
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = size * 0.25;
		ctx.beginPath();
		ctx.moveTo(0, size * 1.1);
		ctx.lineTo(size * 0.75, -size * 0.7);
		ctx.lineTo(-size * 0.75, -size * 0.7);
		ctx.closePath();
		ctx.stroke();
		ctx.fill();
		ctx.restore();
	};
	const drawMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
		ctx.fillStyle = '#ffd84d';
		ctx.strokeStyle = '#2c2a52';
		ctx.lineWidth = size * 0.35;
		ctx.beginPath();
		ctx.moveTo(x, y - size);
		ctx.lineTo(x + size, y);
		ctx.lineTo(x, y + size);
		ctx.lineTo(x - size, y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	};

	const mapCtx = ui.map?.getContext('2d') ?? null;
	const drawMap = (pos: THREE.Vector3, turn: number) => {
		if (!mapCtx || !ui.map) return;
		const s = ui.map.width;
		const k = MAP_PX / (2 * MAP_SPAN);
		mapCtx.fillStyle = FOG;
		mapCtx.fillRect(0, 0, s, s);
		mapCtx.drawImage(shown, toPx(pos.x) - VIEW * k, toPx(pos.z) - VIEW * k, 2 * VIEW * k, 2 * VIEW * k, 0, 0, s, s);
		const toMini = (wx: number, wz: number) => [((wx - pos.x) / VIEW) * 0.5 * s + s / 2, ((wz - pos.z) / VIEW) * 0.5 * s + s / 2];
		for (const p of places) {
			if (!discovered.has(p.id)) continue;
			const [mx, my] = toMini(p.x, p.z);
			if (Math.hypot(mx - s / 2, my - s / 2) < s / 2 - 4) drawMarker(mapCtx, mx, my, s * 0.035);
		}
		drawArrow(mapCtx, s / 2, s / 2, s * 0.045, turn);
	};

	const atlasCtx = ui.atlasMap?.getContext('2d') ?? null;
	const sans = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'system-ui, sans-serif';
	const drawAtlas = (pos: THREE.Vector3, turn: number) => {
		if (!atlasCtx || !ui.atlasMap) return;
		const s = ui.atlasMap.width;
		const toAtlas = (v: number) => ((v / MAP_SPAN) * 0.5 + 0.5) * s;
		atlasCtx.fillStyle = FOG;
		atlasCtx.fillRect(0, 0, s, s);
		atlasCtx.drawImage(shown, 0, 0, s, s);
		atlasCtx.font = `800 ${Math.round(s * 0.03)}px ${sans}`;
		atlasCtx.textAlign = 'center';
		atlasCtx.lineJoin = 'round';
		// Each name goes above its marker, or below it if that would cover a name already written.
		const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
		const line = s * 0.034;
		for (const p of places) {
			if (!discovered.has(p.id)) continue;
			const x = toAtlas(p.x);
			const y = toAtlas(p.z);
			drawMarker(atlasCtx, x, y, s * 0.014);
			const w = atlasCtx.measureText(p.name).width / 2 + s * 0.006;
			const box = (ty: number) => ({ x0: x - w, x1: x + w, y0: ty - line, y1: ty + line * 0.25 });
			const clash = (b: ReturnType<typeof box>) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
			let ty = y - s * 0.025;
			if (clash(box(ty))) ty = y + s * 0.025 + line * 0.75;
			taken.push(box(ty));
			const tx = clamp(x, w, s - w);
			atlasCtx.lineWidth = s * 0.008;
			atlasCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			atlasCtx.strokeText(p.name, tx, ty);
			atlasCtx.fillStyle = '#2c2a52';
			atlasCtx.fillText(p.name, tx, ty);
		}
		drawArrow(atlasCtx, toAtlas(pos.x), toAtlas(pos.z), s * 0.016, turn);
	};
	const sizeCanvas = (c: HTMLCanvasElement | null) => {
		if (!c) return;
		const px = Math.round(c.clientWidth * Math.min(devicePixelRatio, 2));
		if (px && c.width !== px) c.width = c.height = px;
	};

	return {
		announce,
		/** Whether she's been to the place with this id. */
		found: (id: string) => discovered.has(id),
		/** Notices where she's got to, uncovers the map round her and redraws the minimap. */
		update(pos: THREE.Vector3, turn: number) {
			checkPlaces(pos);
			reveal(pos);
			drawMap(pos, turn);
		},
		drawAtlas,
		sizeMinimap: () => sizeCanvas(ui.map),
		sizeAtlas: () => sizeCanvas(ui.atlasMap),
	};
}
