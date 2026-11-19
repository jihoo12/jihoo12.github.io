// What each cell looks like, and what in it she bumps into. The pieces (walls, posts, columns…) come
// from tools/monochrome/build.py; each cell is put together from them once, merged into a mesh per
// material so it's cheap to draw, and cloned wherever it's laid out (some cells are laid out more
// than once round her: that's the sort of place it is). The shades of grey are the page's, so they
// can turn to night, and take on a little colour (each region its own) as the shards come back.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Toon } from '../nixkit/look';
import { createRift, riftMaterial } from './rift';
import { CELL, HALF, SHARDS, turn, type Cell, type Prop, type Region } from './world';

// The pieces' sizes, as tools/monochrome/build.py builds them.
export const WALL_T = 0.5;
const WALL_H = 5;
const DOOR_W = 3.2;
const DOOR_H = 3.6;
const POST = 0.9;
const POST_H = 5.6;
const TALL_H = 32;
const TALL_POST = 1.2;
const STAIRS_LONG = 8 * 0.55 + 1.2;
/** How high the floating cubes hang: over her head, so she walks under them. */
const CUBE_Y = 2.9;

/** Something to bump into, in a cell's own frame: a box (x0…x1, z0…z1, from y0 up to y1) or an
 * upright cylinder (round x, z). The camera keeps out of both; she only meets what's low enough. */
export type Solid = { box: true; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number } | { box: false; x: number; z: number; r: number; y1: number };

/** Something she can do or read with E, in a cell's own frame. */
export interface Spot {
	x: number;
	z: number;
	reach: number;
	kind: 'tablet' | 'shard' | 'home' | 'back' | 'vein';
	text?: string;
	/** For a vein: which one, as it's remembered when it's been chipped. */
	id?: string;
}

export interface CellModel {
	/** The cell, ready to clone. */
	group: THREE.Group;
	solids: Solid[];
	spots: Spot[];
}

type Shade = 'Stone' | 'Dark' | 'Pale' | 'Black' | 'Floor0' | 'Floor1';
const SHADES: Shade[] = ['Stone', 'Dark', 'Pale', 'Black', 'Floor0', 'Floor1'];
const GREYS: Record<'day' | 'night', Record<Shade, string>> = {
	day: { Stone: '#a9a9a9', Dark: '#5d5d5d', Pale: '#ececec', Black: '#2a2a2a', Floor0: '#d5d5d5', Floor1: '#c4c4c4' },
	night: { Stone: '#5f5f66', Dark: '#2e2e33', Pale: '#a2a2aa', Black: '#101012', Floor0: '#3b3b40', Floor1: '#323237' },
};
/** The colour each region would be, if it had any. */
const TINTS: Record<Region, string> = {
	threshold: '#b5a3e8',
	hall: '#6fa8ef',
	wood: '#7fcf86',
	court: '#f2c457',
	yard: '#f29ab0',
	house: '#f0a86e',
	tower: '#a68ae6',
};

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export async function loadBlocks(url: string, toon: Toon) {
	const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
	const gltf = await new GLTFLoader().loadAsync(url);
	gltf.scene.updateMatrixWorld(true);

	// Each piece, as its geometry per material, in the piece's own frame.
	const pieces = new Map<string, { geo: THREE.BufferGeometry; mat: string }[]>();
	for (const root of gltf.scene.children) {
		const inverse = root.matrixWorld.clone().invert();
		const parts: { geo: THREE.BufferGeometry; mat: string }[] = [];
		root.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			const geo = (o.geometry as THREE.BufferGeometry).clone();
			geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
			for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal') geo.deleteAttribute(a);
			parts.push({ geo: geo.index ? geo.toNonIndexed() : geo, mat: (o.material as THREE.Material).name || 'Stone' });
		});
		pieces.set(root.name, parts);
	}

	// The materials: one of each shade per region, so each region can take on its own colour.
	const mats = new Map<string, THREE.MeshToonMaterial>();
	const glow = new THREE.MeshBasicMaterial({ color: '#ffffff' });
	const matFor = (region: Region, shade: Shade) => {
		const k = `${region}:${shade}`;
		let m = mats.get(k);
		if (!m) mats.set(k, (m = toon({ color: '#888888' })));
		return m;
	};
	const grey = new THREE.Color();
	const tint = new THREE.Color();
	/** Paints everything for day or night, `colour` (0 … 1) of the way from grey to its region's colour. */
	const paint = (night: boolean, colour: number) => {
		for (const [k, m] of mats) {
			const [region, shade] = k.split(':') as [Region, Shade];
			grey.set(GREYS[night ? 'night' : 'day'][shade]);
			// The region's colour, at the grey's own lightness, so colour comes in without the light changing.
			tint.set(TINTS[region]);
			tint.multiplyScalar(luminance(grey) / Math.max(luminance(tint), 1e-3));
			m.color.copy(grey).lerp(tint, colour);
		}
		glow.color.set(night ? '#fff6dc' : '#ffffff');
	};

	// The rifts in the grey all share one material, so they churn together.
	const riftMat = riftMaterial();

	/** Builds what a cell looks like and what's solid in it. */
	const build = (cell: Cell): CellModel => {
		const merged = new Map<THREE.Material, THREE.BufferGeometry[]>();
		const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
			const list = merged.get(mat) ?? [];
			list.push(geo);
			merged.set(mat, list);
		};
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const piece = (name: string, x: number, y: number, z: number, yaw = 0) => {
			m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1));
			for (const p of pieces.get(name) ?? []) {
				const geo = p.geo.clone().applyMatrix4(m);
				add(geo, p.mat === 'Glow' ? glow : matFor(cell.region, (SHADES.includes(p.mat as Shade) ? p.mat : 'Stone') as Shade));
			}
		};
		const solids: Solid[] = [];
		const spots: Spot[] = [];
		/** A box in the frame of something turned `yaw` and standing at (x, z), made square again. */
		const turnedBox = (x: number, z: number, yaw: number, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
			const c = Math.cos(yaw);
			const s = Math.sin(yaw);
			const xs: number[] = [];
			const zs: number[] = [];
			for (const [px, pz] of [
				[x0, z0],
				[x1, z0],
				[x0, z1],
				[x1, z1],
			]) {
				// three.js's turn about y: x' = x cos + z sin, z' = -x sin + z cos.
				xs.push(x + px * c + pz * s);
				zs.push(z - px * s + pz * c);
			}
			solids.push({ box: true, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1 });
		};
		const at = (x: number, z: number, yaw: number, dx: number, dz: number): [number, number] => [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw)];

		// The floor: one slab, the shade alternating cell to cell, with a hairline between.
		const floor = new THREE.BoxGeometry(CELL - 0.08, 0.4, CELL - 0.08).toNonIndexed();
		floor.translate(0, -0.2, 0);
		floor.deleteAttribute('uv');
		add(floor, matFor(cell.region, cell.shade ? 'Floor1' : 'Floor0'));

		// The walls, each just inside its side.
		for (let s = 0; s < 4; s++) {
			const edge = cell.edges[s];
			if (edge === 'open') continue;
			const [x, z] = turn(0, -HALF + WALL_T / 2, s);
			const yaw = (-s * Math.PI) / 2;
			piece(edge === 'door' ? 'DoorWall' : edge === 'tall' ? 'TallWall' : 'Wall', x, 0, z, yaw);
			const h = edge === 'tall' ? TALL_H : WALL_H;
			if (edge === 'door') {
				turnedBox(x, z, yaw, -HALF, -DOOR_W / 2, -WALL_T / 2, WALL_T / 2, 0, h);
				turnedBox(x, z, yaw, DOOR_W / 2, HALF, -WALL_T / 2, WALL_T / 2, 0, h);
				turnedBox(x, z, yaw, -DOOR_W / 2, DOOR_W / 2, -WALL_T / 2, WALL_T / 2, DOOR_H, h);
			} else turnedBox(x, z, yaw, -HALF, HALF, -WALL_T / 2, WALL_T / 2, 0, h);
		}
		// The posts at its corners (NW, NE, SE, SW): the tower's, where it meets the tower.
		for (let c = 0; c < 4; c++) {
			const [x, z] = turn(-HALF, -HALF, c);
			const tall = cell.edges[c] === 'tall' || cell.edges[(c + 3) % 4] === 'tall';
			piece(tall ? 'TallPost' : 'Post', x, 0, z);
			const r = (tall ? TALL_POST : POST + 0.2) / 2;
			solids.push({ box: true, x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: 0, y1: tall ? TALL_H : POST_H });
		}

		// What stands about in it.
		const loose: THREE.Object3D[] = [];
		const props: Prop[] = [...cell.props];
		if (cell.shard) props.push({ kind: 'plinth', x: 0, z: 0 });
		for (const p of props) {
			switch (p.kind) {
				case 'column':
					piece('Column', p.x, 0, p.z);
					solids.push({ box: false, x: p.x, z: p.z, r: 0.6, y1: 4.6 });
					break;
				case 'lamp':
					piece('Lamp', p.x, 0, p.z);
					solids.push({ box: false, x: p.x, z: p.z, r: 0.38, y1: 4 });
					break;
				case 'plinth':
					piece('Plinth', p.x, 0, p.z);
					solids.push({ box: false, x: p.x, z: p.z, r: 0.75, y1: 1.1 });
					break;
				case 'cube': {
					// The cubes aren't merged in: they hang in the air and turn.
					const cube = new THREE.Group();
					for (const part of pieces.get('Cube') ?? []) cube.add(new THREE.Mesh(part.geo, matFor(cell.region, 'Black')));
					cube.position.set(p.x, CUBE_Y, p.z);
					cube.name = 'cube';
					cube.userData.phase = p.x * 1.7 + p.z * 0.9;
					loose.push(cube);
					break;
				}
				case 'arch':
					piece('Arch', p.x, 0, p.z, p.yaw);
					for (const side of [-1, 1]) {
						const [x, z] = at(p.x, p.z, p.yaw, side * 2.6, 0);
						solids.push({ box: false, x, z, r: 0.6, y1: 4.5 });
					}
					turnedBox(p.x, p.z, p.yaw, -3.2, 3.2, -0.5, 0.5, 4.0, 5.3);
					break;
				case 'stairs':
					piece('Stairs', p.x, 0, p.z, p.yaw);
					turnedBox(p.x, p.z, p.yaw, -1.2, 1.2, -STAIRS_LONG, 0, 0, 3.4);
					break;
				case 'riftframe': {
					piece('RiftFrame', p.x, 0, p.z, p.yaw);
					for (const side of [-1, 1]) {
						const [x, z] = at(p.x, p.z, p.yaw, side * 1.65, 0);
						solids.push({ box: false, x, z, r: 0.7, y1: 4.4 });
					}
					const rift = createRift(2.3, 3.7, riftMat);
					rift.mesh.position.set(p.x, 3.7 / 2 + 0.05, p.z);
					rift.mesh.rotation.y = p.yaw;
					rift.mesh.name = 'rift';
					loose.push(rift.mesh);
					const [x, z] = at(p.x, p.z, p.yaw, 0, 1.2);
					spots.push({ x, z, reach: 1.9, kind: 'home' });
					break;
				}
				case 'tablet': {
					piece('Tablet', p.x, 0, p.z, p.yaw);
					solids.push({ box: false, x: p.x, z: p.z, r: 0.75, y1: 2.1 });
					const [x, z] = at(p.x, p.z, p.yaw, 0, 1.1);
					spots.push({ x, z, reach: 1.6, kind: 'tablet', text: p.text });
					break;
				}
				case 'vein': {
					// The rock stays; the ore on it is its own, to hide while it grows back.
					const yaw = p.x * 1.3 + p.z * 0.7;
					piece('AshenRock', p.x, 0, p.z, yaw);
					const ore = new THREE.Group();
					for (const part of pieces.get('AshenOre') ?? []) ore.add(new THREE.Mesh(part.geo, matFor(cell.region, part.mat === 'Stone' ? 'Stone' : 'Pale')));
					ore.position.set(p.x, 0, p.z);
					ore.rotation.y = yaw;
					ore.name = `vein:${p.id}`;
					loose.push(ore);
					solids.push({ box: false, x: p.x, z: p.z, r: 0.95, y1: 1.6 });
					spots.push({ x: p.x, z: p.z, reach: 2.1, kind: 'vein', id: p.id });
					break;
				}
				case 'obelisk': {
					const [x, z] = turn(-HALF, -HALF, p.corner);
					piece('Obelisk', x, 0, z);
					solids.push({ box: true, x0: x - 1.7, x1: x + 1.7, z0: z - 1.7, z1: z + 1.7, y0: 0, y1: 9.4 });
					break;
				}
			}
		}
		// The shard over its plinth, and the little rift back to the Threshold that opens once it's
		// taken: both in every copy of the cell, and the page shows whichever's right.
		if (cell.shard) {
			const def = SHARDS.find((s) => s.id === cell.shard)!;
			const shard = new THREE.Group();
			shard.name = 'shard';
			const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: def.color }));
			gem.scale.y = 1.5;
			shard.add(gem);
			shard.position.set(0, 1.9, 0);
			loose.push(shard);
			spots.push({ x: 0, z: 0, reach: 2.1, kind: 'shard' });
			const back = createRift(1.6, 2.6, riftMat);
			back.mesh.name = 'back';
			back.mesh.position.set(0, 2.6 / 2 + 0.05, -2.9);
			loose.push(back.mesh);
			spots.push({ x: 0, z: -2.9, reach: 1.8, kind: 'back' });
		}

		const group = new THREE.Group();
		for (const [mat, geos] of merged) {
			const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
			mesh.castShadow = mat !== glow;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		for (const o of loose) {
			o.traverse((c) => (c.castShadow = c.name !== 'rift' && c.name !== 'back'));
			group.add(o);
		}
		return { group, solids, spots };
	};

	return { build, paint, riftMat };
}

export type Blocks = Awaited<ReturnType<typeof loadBlocks>>;
