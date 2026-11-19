// The menu over the game: her bag, the map, the fish book and help, a tab each. Help opens by
// itself the first time she arrives.
import { loadText, saveText } from './save';
import { closeOnBackdrop } from '../nixkit/util';

export type Tab = 'bag' | 'map' | 'fish' | 'help';

export function createMenu({
	root,
	close,
	onOpen,
	onShow,
}: {
	root: HTMLElement | null;
	close: HTMLButtonElement | null;
	/** The menu's come up over the game (so let go of whatever she's holding). */
	onOpen: () => void;
	/** A tab's been shown, to draw anything on it that needs drawing. */
	onShow: (tab: Tab) => void;
}) {
	let open = false;
	let current: Tab = 'map';
	const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
	const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')];
	const showTab = (tab: Tab) => {
		current = tab;
		for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
		for (const panel of panels) panel.hidden = panel.dataset.panel !== tab;
		onShow(tab);
	};
	const openMenu = (tab: Tab) => {
		if (!root) return;
		open = true;
		root.hidden = false;
		onOpen();
		showTab(tab);
		tabs.find((t) => t.dataset.tab === tab)?.focus();
	};
	const closeMenu = () => {
		if (!root || !open) return;
		open = false;
		root.hidden = true;
		(document.activeElement as HTMLElement | null)?.blur();
	};
	/** Opens the menu at a tab, or closes it if it's already showing that tab. */
	const toggle = (tab: Tab) => {
		if (open && current === tab) closeMenu();
		else openMenu(tab);
	};
	for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab as Tab));
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open]'))
		button.addEventListener('click', () => {
			toggle(button.dataset.open as Tab);
			if (!open) button.blur();
		});
	close?.addEventListener('click', closeMenu);
	closeOnBackdrop(root, closeMenu);

	const firstVisit = (() => {
		if (loadText('helpSeen')) return false;
		saveText('helpSeen', '1');
		return true;
	})();

	return {
		open: openMenu,
		close: closeMenu,
		toggle,
		get isOpen() {
			return open;
		},
		get tab() {
			return current;
		},
		/** Whether this is her first time on the island (when help should open by itself). */
		firstVisit,
	};
}
