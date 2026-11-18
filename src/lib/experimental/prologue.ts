// The few lines that play in the sky between the gate and the island: once the page has faded into
// the sky in the gate (the .warp), these come up one at a time, then the island's name, and then
// she's there. Any key, click or tap skips the lot. Meanwhile the island is fetched, so it's quick
// to come up after.

const LINE_MS = 2600;
const TITLE_MS = 2200;

/** Play the prologue in `[data-prologue]`; resolves when it's done or skipped (at once if it isn't on the page). */
export function playPrologue(prefetch?: string): Promise<void> {
	const root = document.querySelector<HTMLElement>('[data-prologue]');
	if (!root) return Promise.resolve();
	if (prefetch) {
		const link = document.createElement('link');
		link.rel = 'prefetch';
		link.href = prefetch;
		document.head.append(link);
	}
	const lines = [...root.querySelectorAll<HTMLElement>('[data-line]')];
	return new Promise((resolve) => {
		let timer = 0;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			removeEventListener('keydown', onKey, true);
			root.removeEventListener('pointerdown', finish);
			resolve();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			e.preventDefault();
			e.stopPropagation();
			finish();
		};
		const show = (i: number) => {
			lines.forEach((line, j) => line.classList.toggle('on', j === i));
			if (i >= lines.length) return finish();
			timer = window.setTimeout(() => show(i + 1), lines[i].hasAttribute('data-title') ? TITLE_MS : LINE_MS);
		};
		root.hidden = false;
		root.addEventListener('pointerdown', finish);
		addEventListener('keydown', onKey, true);
		// A beat for the sky to settle before the first line.
		timer = window.setTimeout(() => show(0), 350);
	});
}

/** Put it away again (coming back to the page with the browser's back button). */
export function resetPrologue() {
	const root = document.querySelector<HTMLElement>('[data-prologue]');
	if (!root) return;
	root.hidden = true;
	root.querySelectorAll('[data-line]').forEach((line) => line.classList.remove('on'));
}
