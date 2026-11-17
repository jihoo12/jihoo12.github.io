// What the island remembers between visits, all in the browser's localStorage. Every key lives
// here, so it's one place to see what's saved, and one place to bump a key when a format changes
// (as the map did when the island grew). Reading and writing never throw: a private window or a
// full store just means the island forgets.

export const SAVE_KEYS = {
	bag: 'island-bag',
	garden: 'island-garden',
	fishBook: 'island-fish',
	pebbleMet: 'island-pebble',
	places: 'island-places',
	// v2: the island grew, so maps drawn of the old one no longer line up.
	map: 'island-map-v2',
	helpSeen: 'island-help-seen',
	skyChest: 'island-sky-chest',
} as const;

export type SaveKey = keyof typeof SAVE_KEYS;

/** The raw text saved under `key`, or null if there's none (or it can't be read). */
export function loadText(key: SaveKey): string | null {
	try {
		return localStorage.getItem(SAVE_KEYS[key]);
	} catch {
		return null;
	}
}

export function saveText(key: SaveKey, value: string) {
	try {
		localStorage.setItem(SAVE_KEYS[key], value);
	} catch {
		// Too full, or not allowed: it just won't be remembered.
	}
}

/** What's saved under `key`, parsed, or undefined if there's nothing there or it's garbled. The
 * value is untrusted (it may be from an older version, or edited by hand), so check its shape. */
export function loadJSON(key: SaveKey): unknown {
	const text = loadText(key);
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function saveJSON(key: SaveKey, value: unknown) {
	saveText(key, JSON.stringify(value));
}
