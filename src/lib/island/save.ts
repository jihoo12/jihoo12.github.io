// What the island (and the grey place through its rift) remembers between visits, all in the browser's localStorage. Every key lives
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
	skyCrystals: 'island-sky-crystals',
	forge: 'island-forge',
	ore: 'island-ore',
	machines: 'island-machines',
	// The grey place through the rift (/monochrome): the colour shards she's found there, and the
	// snowflakes she's left to find her way.
	monoShards: 'monochrome-shards',
	monoMarks: 'monochrome-marks',
	monoHelpSeen: 'monochrome-help-seen',
	// Ashen ore: when each rock in the grey place was last chipped, and how much she's carrying
	// that hasn't reached the island's bag yet (it goes in when she's back through the rift).
	monoVeins: 'monochrome-veins',
	monoCarried: 'monochrome-carried',
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
