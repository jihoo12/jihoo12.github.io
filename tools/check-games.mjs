// Checks the games in src/games/ against the rules in CONTRIBUTING.md, so a pull request that adds a
// game hears about anything wrong before anyone has to read it. It's a seatbelt, not a sandbox: a
// game is code that runs on the site, and every one is still read before it's merged.
//
//   node tools/check-games.mjs                 check every game
//   node tools/check-games.mjs --changed main  also list files a branch changes outside src/games/<id>/
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const GAMES = join(ROOT, 'src', 'games');
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ASSETS = new Set(['.glb', '.png', '.jpg', '.jpeg', '.webp', '.json', '.mp3', '.ogg']);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_GAME = 6 * 1024 * 1024;
const COLOR = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What a game mustn't do, and why: it would reach outside the game (the network, other pages, the
 * site's saves), or run code the checks can't see. */
const FORBIDDEN = [
	[/\bfetch\s*\(/, 'no network requests (fetch): put what the game needs in its folder'],
	[/\b(XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\b/, 'no network connections'],
	[/\bsendBeacon\b/, 'no network requests (sendBeacon)'],
	[/\b(localStorage|sessionStorage|indexedDB)\b/, "use the `store` the game is given, not the browser's storage directly"],
	[/\bdocument\s*\.\s*cookie\b/, 'no cookies'],
	[/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, 'no eval or new Function'],
	[/\bimport\s*\(/, 'no dynamic import()'],
	[/\b(Worker|SharedWorker|importScripts)\b/, 'no workers'],
	[/\bpostMessage\b/, 'no postMessage'],
	[/\b(innerHTML|outerHTML|insertAdjacentHTML)\b|document\s*\.\s*write/, 'no HTML from strings: use the HUD, or textContent'],
	[/\blocation\s*(\.\s*(href|assign|replace)|=)|\bwindow\s*\.\s*open\b/, 'no navigating away (the Gallery button is how out)'],
	[/\bnavigator\s*\.\s*(clipboard|geolocation|mediaDevices|credentials)\b/, 'no clipboard, location, camera or credentials'],
	[/['"`]\s*(https?:)?\/\/[^'"`\s]/, 'no links to other sites in code: anything the game loads goes in its folder'],
];

/** The code without its comments (roughly: enough that a URL in a comment isn't taken for code). */
const uncommented = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

async function checkGame(id) {
	const dir = join(GAMES, id);
	const where = `src/games/${id}`;
	if (!ID.test(id)) fail(where, 'the folder name is the game id: lower case letters, numbers and dashes (like "sky-garden")');
	const files = walk(dir);
	const names = files.map((f) => relative(dir, f).split(sep).join('/'));
	for (const need of ['meta.ts', 'game.ts']) if (!names.includes(need)) fail(where, `needs a ${need} (copy src/games/_template/)`);

	let total = 0;
	for (const file of files) {
		const name = relative(ROOT, file).split(sep).join('/');
		const size = statSync(file).size;
		total += size;
		const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
		if (ext === '.ts') checkCode(name, readFileSync(file, 'utf8'), dir, file);
		else if (!ASSETS.has(ext)) fail(name, `files can be .ts, or assets (${[...ASSETS].join(' ')})`);
		if (size > MAX_FILE) fail(name, `${(size / 1048576).toFixed(1)} MB is more than ${MAX_FILE / 1048576} MB for one file`);
	}
	if (total > MAX_GAME) fail(where, `${(total / 1048576).toFixed(1)} MB in all is more than ${MAX_GAME / 1048576} MB for a game`);

	if (names.includes('meta.ts')) {
		let meta;
		try {
			meta = (await import(pathToFileURL(join(dir, 'meta.ts')).href)).default;
		} catch (err) {
			return fail(`${where}/meta.ts`, `couldn't be read: ${err.message}`);
		}
		const text = (k, max) => {
			if (typeof meta?.[k] !== 'string' || !meta[k].trim()) fail(`${where}/meta.ts`, `\`${k}\` should be some text`);
			else if (meta[k].length > max) fail(`${where}/meta.ts`, `\`${k}\` should be ${max} characters at most`);
		};
		text('title', 32);
		text('note', 48);
		text('description', 240);
		text('author', 40);
		if (meta?.github !== undefined && !/^[A-Za-z0-9-]{1,39}$/.test(meta.github)) fail(`${where}/meta.ts`, '`github` should be a GitHub username');
		if (!Array.isArray(meta?.colors) || meta.colors.length !== 2 || !meta.colors.every((c) => COLOR.test(c))) fail(`${where}/meta.ts`, '`colors` should be two colours like "#ff8ad8"');
		if (typeof meta?.added !== 'string' || !DATE.test(meta.added)) fail(`${where}/meta.ts`, '`added` should be a date like "2026-11-19"');
		if (meta?.keys !== undefined && (typeof meta.keys !== 'string' || meta.keys.length > 60)) fail(`${where}/meta.ts`, '`keys` should be a short hint like "R restart"');
	}
}

function checkCode(name, code, dir, file) {
	const body = uncommented(code);
	const lines = body.split('\n');
	for (const [re, why] of FORBIDDEN) {
		const at = lines.findIndex((l) => re.test(l));
		if (at >= 0) fail(`${name}:${at + 1}`, why);
	}
	for (const m of body.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)) {
		const spec = m[1] ?? m[2];
		if (spec === 'three' || spec.startsWith('three/examples/jsm/')) continue;
		if (spec.startsWith('.')) {
			const target = resolve(file, '..', spec);
			const nixkit = join(ROOT, 'src', 'lib', 'nixkit');
			if (target.startsWith(dir + sep) || target.startsWith(nixkit + sep)) continue;
			fail(name, `"${spec}": a game imports from its own folder, from src/lib/nixkit/, and from three, and nothing else`);
			continue;
		}
		fail(name, `"${spec}": the only package a game can use is three`);
	}
}

const ids = readdirSync(GAMES, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
for (const id of ids) await checkGame(id);
// The template is checked too (it's what everyone copies), but not as a game of its own.
await checkGame('_template').catch(() => {});
for (let i = errors.length - 1; i >= 0; i--) if (errors[i].startsWith('src/games/_template:') && errors[i].includes('folder name')) errors.splice(i, 1);

// Which files the branch changes outside a game's folder: fine for the site's owner, but in a pull
// request adding a game, they're the ones to look at most carefully.
const changed = process.argv.indexOf('--changed');
if (changed >= 0) {
	const base = process.argv[changed + 1] ?? 'origin/main';
	try {
		const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
		const outside = out.split('\n').filter((f) => f && !/^src\/games\/[^/]+\//.test(f));
		if (outside.length) warnings.push(`changes outside src/games/<id>/ (a game shouldn't need any):\n${outside.map((f) => `  ${f}`).join('\n')}`);
		const touched = new Set(out.split('\n').map((f) => f.match(/^src\/games\/([^/]+)\//)?.[1]).filter(Boolean));
		if (touched.size > 1) warnings.push(`changes ${touched.size} games (${[...touched].join(', ')}): one pull request per game is easier to look at`);
	} catch (err) {
		warnings.push(`couldn't compare with ${base}: ${err.message.split('\n')[0]}`);
	}
}

const ci = !!process.env.GITHUB_ACTIONS;
for (const w of warnings) console.log(ci ? `::warning::${w.replaceAll('\n', '%0A')}` : `warning: ${w}`);
for (const e of errors) console.log(ci ? `::error::${e}` : `error: ${e}`);
console.log(errors.length ? `\n${errors.length} problem${errors.length === 1 ? '' : 's'} in src/games/ (see CONTRIBUTING.md).` : `${ids.length} game${ids.length === 1 ? '' : 's'} checked: all good.`);
process.exit(errors.length ? 1 : 0);
