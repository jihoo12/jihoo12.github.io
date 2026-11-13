import { getCollection } from 'astro:content';

/** Published comics, newest first. Drafts only show up in `astro dev`. */
export async function publishedComics() {
	const comics = await getCollection('comics', ({ data }) => import.meta.env.DEV || !data.draft);
	return comics.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** A comic's URL slug is its folder name. */
export const comicSlug = (id: string) => id.replace(/\/index$/, '');
