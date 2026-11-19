// What a Nixkit game shows over the 3D: the touch stick and jump button, a banner for big moments,
// a toast for small ones, and a row of counters (coins, a clock…). It makes its own elements and
// styles, so a game needs no markup of its own beyond a canvas.

const STYLE = `
.nk-hud { position: fixed; inset: 0; pointer-events: none; z-index: 20; font-family: var(--sans, system-ui, sans-serif); -webkit-user-select: none; user-select: none; }
.nk-hud > * { pointer-events: auto; }
.nk-stats { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: none; }
.nk-stat { padding: 6px 13px; border-radius: 999px; background: var(--surface, #fff); color: var(--ink, #1c1a3e); font-size: 15px; font-weight: 900; box-shadow: 0 4px 0 var(--edge, #c9c6e6); font-variant-numeric: tabular-nums; white-space: nowrap; }
.nk-banner { position: fixed; top: 120px; left: 50%; transform: translate(-50%, -6px); width: max-content; max-width: calc(100% - 32px); text-align: center; pointer-events: none; opacity: 0; transition: opacity 0.5s, transform 0.5s; }
.nk-banner.show { opacity: 1; transform: translate(-50%, 0); }
.nk-banner p { margin: 0; }
.nk-banner-title { font-family: var(--display, inherit); font-size: clamp(30px, 6vw, 48px); line-height: 1.1; color: #fdfbff; text-shadow: 0 2px 0 #2c2a52, 0 0 18px rgba(28, 26, 62, 0.45); }
.nk-banner-note { display: inline-block; margin-top: 8px !important; padding: 3px 12px; border-radius: 999px; background: var(--star, #ffd84d); color: #1c1a3e; font-size: 14px; font-weight: 900; }
.nk-banner-note:empty { display: none; }
.nk-toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 8px); max-width: calc(100% - 32px); margin: 0; padding: 8px 16px; border-radius: 999px; background: var(--surface, #fff); color: var(--ink, #1c1a3e); font-size: 15px; font-weight: 800; box-shadow: 0 4px 0 var(--edge, #c9c6e6); opacity: 0; transition: opacity 0.3s, transform 0.3s; pointer-events: none; text-align: center; }
.nk-toast.show { opacity: 1; transform: translate(-50%, 0); }
.nk-flash { position: fixed; inset: 0; background: #fdfbff; opacity: 0; pointer-events: none; transition: opacity 0.35s; }
.nk-flash.show { opacity: 0.55; transition: none; }
.nk-stick { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.nk-stick[hidden] { display: none; }
.nk-stick::before, .nk-knob { content: ''; position: absolute; border-radius: 50%; }
.nk-stick::before { left: -60px; top: -60px; width: 120px; height: 120px; background: color-mix(in srgb, var(--surface, #fff) 45%, transparent); box-shadow: inset 0 0 0 3px var(--surface, #fff); }
.nk-knob { left: -26px; top: -26px; width: 52px; height: 52px; background: var(--surface, #fff); box-shadow: 0 4px 0 var(--edge, #c9c6e6); }
.nk-jump { display: none; position: fixed; right: 24px; bottom: 96px; width: 76px; height: 76px; border: 0; border-radius: 50%; background: var(--surface, #fff); color: var(--ink, #1c1a3e); font: 900 32px var(--sans, system-ui); box-shadow: 0 5px 0 var(--edge, #c9c6e6); touch-action: none; }
.nk-jump:active { transform: translateY(3px); box-shadow: 0 2px 0 var(--edge, #c9c6e6); }
@media (pointer: coarse) { .nk-jump { display: block; } }
/* Going through a portal, everything fades to white. */
.nk-leaving .nk-flash { opacity: 1; transition: opacity 0.4s; }
@media (max-width: 560px) { .nk-stats { top: 62px; } .nk-stat { font-size: 13px; padding: 5px 10px; } }
`;

export function createHud() {
	if (!document.querySelector('style[data-nk-hud]')) {
		const style = document.createElement('style');
		style.dataset.nkHud = '';
		style.textContent = STYLE;
		document.head.append(style);
	}
	const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => {
		const e = document.createElement(tag);
		e.className = cls;
		parent.append(e);
		return e;
	};
	const root = el('div', 'nk-hud', document.body);
	const flash = el('div', 'nk-flash', root);
	const stats = el('div', 'nk-stats', root);
	const banner = el('div', 'nk-banner', root);
	banner.setAttribute('aria-live', 'polite');
	const bannerTitle = el('p', 'nk-banner-title', banner);
	const bannerNote = el('p', 'nk-banner-note', banner);
	const toast = el('p', 'nk-toast', root);
	toast.setAttribute('aria-live', 'polite');
	const stick = el('div', 'nk-stick', root);
	stick.hidden = true;
	stick.setAttribute('aria-hidden', 'true');
	const knob = el('div', 'nk-knob', stick);
	const jump = el('button', 'nk-jump', root);
	jump.type = 'button';
	jump.textContent = '⤒';
	jump.setAttribute('aria-label', 'Jump');

	let bannerTimer = 0;
	let toastTimer = 0;
	return {
		/** For the controls: the touch stick and the jump button. */
		touch: { stick, knob, jump },
		/** A big title across the top (and a note under it), for a while. */
		banner(title: string, note = '', seconds = 3) {
			bannerTitle.textContent = title;
			bannerNote.textContent = note;
			banner.classList.add('show');
			clearTimeout(bannerTimer);
			bannerTimer = window.setTimeout(() => banner.classList.remove('show'), seconds * 1000);
		},
		/** A line at the bottom of the screen, for a moment. */
		toast(text: string, seconds = 2.4) {
			toast.textContent = text;
			toast.classList.add('show');
			clearTimeout(toastTimer);
			toastTimer = window.setTimeout(() => toast.classList.remove('show'), seconds * 1000);
		},
		/** A white flash over everything (as when she's put back at a checkpoint). */
		flash() {
			flash.classList.add('show');
			requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('show')));
		},
		/** A counter in the row along the top; set its text whenever it changes. */
		stat(text = '') {
			const s = el('span', 'nk-stat', stats);
			s.textContent = text;
			return {
				set(t: string) {
					if (s.textContent !== t) s.textContent = t;
				},
			};
		},
	};
}

export type Hud = ReturnType<typeof createHud>;
