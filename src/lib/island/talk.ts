// The conversation box at the foot of the screen, and the speech bubble over someone's head, shared
// by everyone on the island Nixchan can talk to (Pebble at the stand, Hollis under Cloudrest). Whoever
// opens it gives their name and colour; their words type out, then the choices show, and the keys
// (or a tap) pick one. Only one of them talks at a time.
import * as THREE from 'three';

export interface Choice {
	label: string;
	run: () => void;
}

export interface Speaker {
	name: string;
	/** The colour of the tag their name sits on. */
	color: string;
	/** Their words are typing out, or have finished. */
	onSay?: () => void;
	onTyped?: () => void;
	onClose?: () => void;
}

export function createTalk(camera: THREE.Camera) {
	const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
	const ui = {
		talk: $('[data-talk]'),
		name: $('[data-talk-name]'),
		text: $('[data-talk-text]'),
		choices: $('[data-talk-choices]'),
		bubble: $('[data-bubble]'),
	};

	let speaker: Speaker | null = null;
	let typing = '';
	let shown = 0;
	let choices: Choice[] = [];
	let chosen = 0;
	let closeAt = 0;

	const drawChoices = () => {
		if (!ui.choices) return;
		ui.choices.replaceChildren(
			...choices.map((c, i) => {
				const b = document.createElement('button');
				b.type = 'button';
				b.textContent = c.label;
				b.setAttribute('aria-pressed', String(i === chosen));
				b.addEventListener('click', () => c.run());
				return b;
			}),
		);
	};

	const say = (text: string, next: Choice[]) => {
		typing = text;
		shown = 0;
		choices = next;
		chosen = 0;
		if (ui.text) ui.text.textContent = '';
		ui.choices?.replaceChildren();
		speaker?.onSay?.();
	};

	const close = () => {
		const was = speaker;
		speaker = null;
		closeAt = 0;
		if (ui.talk) ui.talk.hidden = true;
		was?.onClose?.();
	};

	/** Starts a conversation with `who`; returns false if there's no box to talk in. */
	const open = (who: Speaker) => {
		if (!ui.talk) return false;
		if (speaker && speaker !== who) close();
		speaker = who;
		closeAt = 0;
		ui.talk.hidden = false;
		ui.talk.setAttribute('aria-label', `Talking with ${who.name}`);
		if (ui.name) {
			ui.name.textContent = who.name;
			ui.name.style.background = who.color;
		}
		return true;
	};

	/** Keys while someone's talking: E, Space or Enter to hurry them along or pick, arrows to choose, Esc to go. */
	const key = (k: string) => {
		if (k === 'escape') return close();
		if (k === 'arrowleft' || k === 'arrowup') chosen = (chosen + choices.length - 1) % Math.max(choices.length, 1);
		else if (k === 'arrowright' || k === 'arrowdown') chosen = (chosen + 1) % Math.max(choices.length, 1);
		else if (k === 'e' || k === ' ' || k === 'enter') {
			if (shown < typing.length) shown = typing.length;
			else if (choices[chosen]) return choices[chosen].run();
			else if (!choices.length) return close();
		} else if (/^[1-9]$/.test(k) && choices[Number(k) - 1]) return choices[Number(k) - 1].run();
		drawChoices();
	};

	// ---------- the bubble ----------

	let bubbleUntil = 0;
	let bubbleAt: THREE.Vector3 | null = null;
	const above = new THREE.Vector3();

	return {
		open,
		say,
		close,
		key,
		/** Says something with no choices after it, then closes. */
		bye(text: string) {
			say(text, []);
			closeAt = performance.now() + 1600;
		},
		/** Who's talking, if anyone. */
		get speaker() {
			return speaker;
		},
		get talking() {
			return speaker !== null;
		},
		/** A few words in a bubble over `at` (a point that's kept up with as it moves). */
		bubble(text: string, at: THREE.Vector3, seconds = 2.6) {
			if (!ui.bubble) return;
			ui.bubble.textContent = text;
			ui.bubble.hidden = false;
			bubbleAt = at;
			bubbleUntil = performance.now() + seconds * 1000;
		},
		update(dt: number) {
			const now = performance.now();
			if (speaker) {
				if (shown < typing.length) {
					shown = Math.min(typing.length, shown + dt * 55);
					if (ui.text) ui.text.textContent = typing.slice(0, Math.floor(shown));
					if (shown >= typing.length) {
						drawChoices();
						speaker.onTyped?.();
					}
				}
				if (closeAt && now > closeAt) close();
			}
			if (ui.bubble && !ui.bubble.hidden && bubbleAt) {
				if (now > bubbleUntil || speaker) ui.bubble.hidden = true;
				above.copy(bubbleAt).project(camera);
				const onScreen = above.z < 1 && Math.abs(above.x) < 1.1 && Math.abs(above.y) < 1.1;
				ui.bubble.style.visibility = onScreen ? 'visible' : 'hidden';
				ui.bubble.style.transform = `translate(${((above.x + 1) / 2) * innerWidth}px, ${((1 - above.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
			}
		},
	};
}

export type Talk = ReturnType<typeof createTalk>;
