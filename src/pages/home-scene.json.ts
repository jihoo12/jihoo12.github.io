// What Nixchan's 3D path (https://jihoo12.github.io/nixchan/experimental/, github.com/jihoo12/nixchan)
// walks past: the busiest projects, the latest notes and comics. It's the same origin, so the path
// fetches this as it opens.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getImage } from 'astro:assets';
import { featuredProjects } from '../lib/projects';
import { publishedComics, comicSlug } from '../lib/comics';

const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

export const GET: APIRoute = async () => {
	const projects = (await featuredProjects(3)).map(({ data, commits }) => ({
		title: data.title,
		tagline: data.tagline,
		language: data.language,
		commits,
		href: data.repo,
	}));

	const posts = (await getCollection('blog'))
		.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
		.slice(0, 3)
		.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			date: dateLabel.format(post.data.pubDate),
			href: `/blog/${post.id}/`,
		}));

	const comics = await Promise.all(
		(await publishedComics()).slice(0, 3).map(async (comic) => ({
			title: comic.data.title,
			href: `/comics/${comicSlug(comic.id)}/`,
			image: (await getImage({ src: comic.data.cover ?? comic.data.pages[0].src, width: 640, format: 'webp' })).src,
		})),
	);

	return new Response(JSON.stringify({ projects, posts, comics }), { headers: { 'Content-Type': 'application/json' } });
};
