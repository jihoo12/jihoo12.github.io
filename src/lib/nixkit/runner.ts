// Runs a game from src/games/<id>/ on its page (pages/games/[id].astro): finds its game.ts, gives it
// what it needs, and looks after the loading screen.
import { createGame } from './game';
import { createStore, type StartGame } from './meta';

const GAMES = import.meta.glob<{ default: StartGame }>('../../games/*/game.ts');

export async function runGame(id: string) {
	const canvas = document.querySelector<HTMLCanvasElement>('[data-stage]');
	const loading = document.querySelector<HTMLElement>('[data-loading]');
	const fail = (text: string) => {
		if (loading) loading.textContent = text;
	};
	const load = GAMES[`../../games/${id}/game.ts`];
	if (!canvas || !load) return fail("This game couldn't be found.");
	let start: StartGame;
	try {
		start = (await load()).default;
	} catch (err) {
		console.error(err);
		return fail("This game couldn't be loaded just now. Try reloading?");
	}
	start({
		id,
		store: createStore(id),
		createGame(opts) {
			const game = createGame({
				...opts,
				canvas,
				modelUrl: canvas.dataset.model ?? '',
				onFail: (why) => fail(why === 'webgl' ? 'This game needs WebGL, which this browser has turned off.' : "Nixchan couldn't make it here just now. Try reloading?"),
			});
			game?.loaded.then(
				() => loading?.setAttribute('hidden', ''),
				() => {},
			);
			if (game && import.meta.env.DEV) Object.assign(window, { game });
			return game;
		},
	});
}
