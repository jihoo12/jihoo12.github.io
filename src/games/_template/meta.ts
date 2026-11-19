// Copy this folder to src/games/<your-game-id>/ (lower case letters, numbers and dashes), and
// fill this in. See CONTRIBUTING.md.
import type { GameMeta } from '../../lib/nixkit/meta';

export default {
	title: 'My Game',
	note: 'What it is, in a few words',
	description: 'A sentence or two about the game, for its page.',
	author: 'Your name',
	github: 'your-github-username',
	colors: ['#5fd3ff', '#8f7bff'],
	keys: '',
	added: '2026-01-01',
} satisfies GameMeta;
