import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
		}),
});

// Korean translations of blog posts. The file name must match the English post's id.
const blogKo = defineCollection({
	loader: glob({ base: './src/content/blog-ko', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			// The date of the English version this translation follows.
			translatedFrom: z.coerce.date(),
			heroImage: z.optional(image()),
		}),
});

// Comics: one folder per episode, holding an index.md and its page images.
// `pages` lists the images top to bottom; each is a path, or { src, alt } to describe the panel.
const comics = defineCollection({
	loader: glob({ base: './src/content/comics', pattern: '**/index.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			// Defaults to the first page.
			cover: z.optional(image()),
			pages: z
				.array(z.union([image(), z.object({ src: image(), alt: z.string() })]))
				.min(1)
				.transform((pages) => pages.map((p) => (typeof p === 'object' && 'alt' in p ? p : { src: p, alt: '' }))),
			// Language of the title, description, note and the words in the panels.
			lang: z.enum(['en', 'ko']).default('en'),
			draft: z.boolean().default(false),
		}),
});

// Paper drafts: exploratory, paper-shaped write-ups, mostly written with an AI. Not peer reviewed.
const papers = defineCollection({
	loader: glob({ base: './src/content/papers', pattern: '**/[^_]*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		abstract: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		authors: z.array(z.string()).default(['Jihoo']),
		// The AI that wrote most of it, e.g. "Claude" or "ChatGPT". Shown in the notice on top.
		writtenWith: z.string().optional(),
		lang: z.enum(['en', 'ko']).default('en'),
		// Only shows up in `astro dev`.
		draft: z.boolean().default(false),
	}),
});

export const collections = { blog, blogKo, comics, papers };
