// What Nixchan's wearing: the colour of her hoodie and the design on its front (logos.ts), which hat,
// and the hat's colour. She changes at the wardrobe in her house on /island (island/house.ts), and
// the choice is saved in the browser, so she's dressed the same wherever her figure shows up
// (/island, /experimental, /skills).
import { loadJSON, saveJSON } from '../island/save';
import { LOGOS, LOGO_COLOURS, type LogoColourId, type LogoId } from './logos';
import type { NixFigure } from './nix-figure';

/** Colours for her hoodie and her hat: the main colour, and the deeper one for cuffs and bands. */
export const COLOURS = [
	{ id: 'navy', name: 'Midnight', main: '#2c2a52', deep: '#22203f' },
	{ id: 'cherry', name: 'Cherry', main: '#e0606f', deep: '#b8475a' },
	{ id: 'mint', name: 'Mint', main: '#5fbf9f', deep: '#3f9a7c' },
	{ id: 'sky', name: 'Sky', main: '#5fa8e8', deep: '#3f86c8' },
	{ id: 'cream', name: 'Cream', main: '#efe4cc', deep: '#d4c29d' },
	{ id: 'plum', name: 'Plum', main: '#8a5fb8', deep: '#6c4596' },
] as const;
export type ColourId = (typeof COLOURS)[number]['id'];

export const HATS = [
	{ id: 'beanie', name: 'Cat beanie', tinted: true },
	{ id: 'straw', name: 'Straw hat', tinted: false },
	{ id: 'bucket', name: 'Bucket hat', tinted: true },
	{ id: 'none', name: 'No hat', tinted: false },
] as const;
export type HatId = (typeof HATS)[number]['id'];

export interface Outfit {
	hoodie: ColourId;
	logo: LogoId;
	logoColour: LogoColourId;
	hat: HatId;
	hatColour: ColourId;
}

export const DEFAULT_OUTFIT: Outfit = { hoodie: 'navy', logo: 'snowflake', logoColour: 'ice', hat: 'beanie', hatColour: 'navy' };

const colour = (id: string) => COLOURS.find((c) => c.id === id);

/** The outfit she last changed into, or the one she came in. */
export function loadOutfit(): Outfit {
	const saved = loadJSON('outfit') as Partial<Outfit> | undefined;
	return {
		hoodie: colour(saved?.hoodie ?? '')?.id ?? DEFAULT_OUTFIT.hoodie,
		logo: LOGOS.find((l) => l.id === saved?.logo)?.id ?? DEFAULT_OUTFIT.logo,
		logoColour: LOGO_COLOURS.find((c) => c.id === saved?.logoColour)?.id ?? DEFAULT_OUTFIT.logoColour,
		hat: HATS.find((h) => h.id === saved?.hat)?.id ?? DEFAULT_OUTFIT.hat,
		hatColour: colour(saved?.hatColour ?? '')?.id ?? DEFAULT_OUTFIT.hatColour,
	};
}

export function saveOutfit(outfit: Outfit) {
	saveJSON('outfit', outfit);
}

/** Dresses her figure in `outfit`. */
export function wear(figure: NixFigure, outfit: Outfit) {
	const hoodie = colour(outfit.hoodie) ?? COLOURS[0];
	const hat = colour(outfit.hatColour) ?? COLOURS[0];
	figure.tint('Hoodie', hoodie.main);
	figure.tint('HoodieTrim', hoodie.deep);
	// The beanie and the bucket hat take the hat's colour (the straw hat's always straw).
	figure.tint('Hat', hat.main);
	figure.tint('HatTrim', hat.deep);
	figure.tint('Bucket', hat.main);
	figure.setHat(outfit.hat);
	figure.setLogo(outfit.logo, (LOGO_COLOURS.find((c) => c.id === outfit.logoColour) ?? LOGO_COLOURS[0]).hex);
}
