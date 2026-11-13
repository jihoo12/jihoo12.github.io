import { getCollection } from 'astro:content';

/** Published paper drafts, newest first. Ones marked `draft: true` only show up in `astro dev`. */
export async function publishedPapers() {
	const papers = await getCollection('papers', ({ data }) => import.meta.env.DEV || !data.draft);
	return papers.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
