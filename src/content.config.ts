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

const projects = defineCollection({
	// Hand-written project notes in `src/content/projects/`.
	loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		tagline: z.string(),
		language: z.string(),
		status: z.enum(['active', 'experimental', 'paused']).default('active'),
		tags: z.array(z.string()).default([]),
		repo: z.string().url(),
		links: z.array(z.object({ label: z.string(), href: z.string().url() })).default([]),
		// Published package, if the project ships to a registry.
		package: z
			.object({
				registry: z.enum(['npm', 'pypi']),
				name: z.string(),
			})
			.optional(),
		// The busiest repos of the last 30 days get the full cards (see src/lib/projects.ts);
		// `featured` and `order` decide who fills the remaining spots.
		featured: z.boolean().default(false),
		order: z.number().default(100),
	}),
});

export const collections = { blog, blogKo, projects };
