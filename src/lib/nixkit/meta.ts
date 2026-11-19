// What a game in src/games/<id>/ is made of, as the site sees it: a meta.ts that says what the game
// is called and who made it (read when the site is built, for its page and its portal in the
// gallery), and a game.ts that starts it (run in the browser, on its page at /games/<id>/).
// See CONTRIBUTING.md.
import type { GameOptions, createGame } from './game';

export interface GameMeta {
	/** Its name, on its portal and its page. */
	title: string;
	/** A few words under the name, on its portal: what it is. */
	note: string;
	/** A sentence or two for its page's description (search engines, link previews). */
	description: string;
	/** Who made it, as they'd like to be credited. */
	author: string;
	/** Their GitHub username, for a link. */
	github?: string;
	/** The two colours swirling in its portal. */
	colors: [string, string];
	/** Keys it uses beyond moving and jumping, for the hint at the bottom (e.g. "R restart"). */
	keys?: string;
	/** When it was added (YYYY-MM-DD): the gallery puts the portals in this order. */
	added: string;
}

/** Remembers small things for one game between visits (a best time, a level reached), in the
 * browser. Everything is kept under the game's own name, so games can't trip over each other's
 * saves (or the island's). Reading and writing never throw. */
export interface GameStore {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
}

export function createStore(id: string): GameStore {
	const name = (key: string) => `game-${id}-${key}`;
	return {
		get(key) {
			try {
				const text = localStorage.getItem(name(key));
				return text === null ? undefined : JSON.parse(text);
			} catch {
				return undefined;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(name(key), JSON.stringify(value));
			} catch {
				// Too full, or not allowed: it just won't be remembered.
			}
		},
	};
}

/** What a game's start function is given. */
export interface GameContext {
	/** Makes the game: Nixchan, the camera, the controls, the HUD and a world of parts. The page's
	 * canvas, her model and the loading screen are already taken care of. */
	createGame(opts: Omit<GameOptions, 'canvas' | 'modelUrl' | 'onFail'>): ReturnType<typeof createGame>;
	/** Somewhere to remember things between visits. */
	store: GameStore;
	/** This game's id (its folder's name). */
	id: string;
}

/** What game.ts exports by default. */
export type StartGame = (ctx: GameContext) => void;
