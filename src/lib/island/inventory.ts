// Nixchan's bag: what she's carrying, a stack to a slot. It doesn't know about fish or anything
// else in particular: each kind of thing she can carry is registered with a name, a picture and the
// things she can do with it (let a fish go; later, plant a seed or eat a turnip), and the rest of the
// island adds and takes items by id. What's in the bag is remembered in the browser.

export type ItemKind = 'fish' | 'seed' | 'crop' | 'tool';

const KIND_LABEL: Record<ItemKind, string> = { fish: 'Fish', seed: 'Seed', crop: 'Crop', tool: 'Tool' };

export interface ItemAction {
	label: string;
	/** Does the thing, given the item's id; the action takes any items out of the bag itself. */
	run: (id: string) => void;
}

export interface ItemDef {
	id: string;
	name: string;
	kind: ItemKind;
	description: string;
	/** Shown until (or instead of) a picture. */
	color: string;
	/** A picture of it, as an image URL, once there is one. */
	icon?: () => string | null;
	actions?: ItemAction[];
}

export interface Inventory {
	register(def: ItemDef): void;
	/** Puts `n` in the bag, if there's room: a slot of their own, or the stack they join. */
	add(id: string, n?: number): boolean;
	remove(id: string, n?: number): boolean;
	count(id: string): number;
	has(id: string): boolean;
	/** Draws the bag again, as when a picture comes in. */
	render(): void;
}

export function createInventory({ slots, storageKey, grid, detail, summary }: { slots: number; storageKey: string; grid: HTMLElement | null; detail: HTMLElement | null; summary: HTMLElement | null }): Inventory {
	const defs = new Map<string, ItemDef>();
	/** In the order they went in, which is the order they sit in the bag. */
	const stacks = new Map<string, number>();
	let selected: string | null = null;

	try {
		const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
		if (Array.isArray(saved))
			for (const entry of saved)
				if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] > 0) stacks.set(entry[0], Math.floor(entry[1]));
	} catch {
		// An empty bag, then.
	}
	const save = () => {
		try {
			localStorage.setItem(storageKey, JSON.stringify([...stacks]));
		} catch {
			// It just won't be remembered.
		}
	};

	const picture = (def: ItemDef | undefined, className: string) => {
		const el = document.createElement('span');
		el.className = className;
		const url = def?.icon?.();
		if (url) el.style.backgroundImage = `url(${url})`;
		else el.style.backgroundColor = def?.color ?? '#c9d3ff';
		return el;
	};

	const renderDetail = () => {
		if (!detail) return;
		const def = selected ? defs.get(selected) : undefined;
		const n = selected ? (stacks.get(selected) ?? 0) : 0;
		if (!def || !n) {
			const empty = document.createElement('p');
			empty.className = 'bag-empty';
			empty.textContent = stacks.size ? 'Pick something to look at it.' : 'Nothing in here yet. Try fishing off the pier!';
			detail.replaceChildren(empty);
			return;
		}
		const name = document.createElement('h3');
		name.textContent = def.name;
		const tag = document.createElement('span');
		tag.className = `bag-tag kind-${def.kind}`;
		tag.textContent = `${KIND_LABEL[def.kind]} · ×${n}`;
		const about = document.createElement('p');
		about.textContent = def.description;
		const actions = document.createElement('div');
		actions.className = 'bag-actions';
		for (const action of def.actions ?? []) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'pill';
			button.textContent = action.label;
			button.addEventListener('click', () => action.run(def.id));
			actions.append(button);
		}
		const text = document.createElement('div');
		text.append(name, tag, about, actions);
		detail.replaceChildren(picture(def, 'bag-picture'), text);
	};

	const render = () => {
		if (summary) {
			const total = [...stacks.values()].reduce((a, b) => a + b, 0);
			summary.textContent = `${stacks.size} of ${slots} slots used · ${total} ${total === 1 ? 'thing' : 'things'} in all`;
		}
		if (grid) {
			const cells: HTMLElement[] = [];
			const ids = [...stacks.keys()];
			for (let i = 0; i < slots; i++) {
				const id = ids[i];
				const def = id ? defs.get(id) : undefined;
				const cell = document.createElement('button');
				cell.type = 'button';
				cell.className = 'slot';
				if (!id) {
					cell.disabled = true;
					cell.setAttribute('aria-label', 'Empty slot');
				} else {
					cell.setAttribute('aria-label', `${def?.name ?? id}, ${stacks.get(id)}`);
					cell.setAttribute('aria-pressed', String(id === selected));
					cell.append(picture(def, 'slot-picture'));
					const n = document.createElement('span');
					n.className = 'slot-count';
					n.textContent = String(stacks.get(id));
					cell.append(n);
					cell.addEventListener('click', () => {
						selected = id;
						render();
					});
				}
				cells.push(cell);
			}
			grid.replaceChildren(...cells);
		}
		renderDetail();
	};

	const changed = () => {
		if (selected && !stacks.has(selected)) selected = null;
		save();
		render();
	};

	return {
		register(def) {
			defs.set(def.id, def);
		},
		add(id, n = 1) {
			if (!stacks.has(id) && stacks.size >= slots) return false;
			stacks.set(id, (stacks.get(id) ?? 0) + n);
			selected ??= id;
			changed();
			return true;
		},
		remove(id, n = 1) {
			const have = stacks.get(id) ?? 0;
			if (have < n) return false;
			if (have === n) stacks.delete(id);
			else stacks.set(id, have - n);
			changed();
			return true;
		},
		count: (id) => stacks.get(id) ?? 0,
		has: (id) => stacks.has(id),
		render,
	};
}
