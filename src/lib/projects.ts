import { getCollection, type CollectionEntry } from 'astro:content';
import { GITHUB_USER } from '../consts';
import { recentActivity, type RepoActivity } from './activity';

export type ProjectData = CollectionEntry<'projects'>['data'];

export interface FeaturedProject {
	data: ProjectData;
	// Hand-written notes, when the repo has a file in `src/content/projects/`.
	entry?: CollectionEntry<'projects'>;
	// Commits in the activity window; 0 for repos picked from the curated order.
	commits: number;
}

const repoKey = (url: string) => url.toLowerCase().replace(/(\.git)?\/?$/, '');

function fromRepo(repo: RepoActivity): ProjectData {
	const sentence = repo.description.split('. ')[0].replace(/\.?\s*$/, '.');
	return {
		title: repo.name,
		tagline: sentence,
		language: repo.language,
		status: 'active',
		tags: repo.topics.slice(0, 3),
		repo: repo.url,
		links: [],
		featured: true,
		order: 0,
	};
}

// The busiest repos lately, then `featured` and `order` from the notes to fill a quiet month.
export async function featuredProjects(count: number): Promise<FeaturedProject[]> {
	const entries = (await getCollection('projects')).sort((a, b) => a.data.order - b.data.order);
	const byRepo = new Map(entries.map((entry) => [repoKey(entry.data.repo), entry]));
	const picks: FeaturedProject[] = [];
	const taken = new Set<string>();

	for (const repo of await recentActivity(GITHUB_USER)) {
		const entry = byRepo.get(repoKey(repo.url));
		if (!entry && !repo.description) continue; // nothing to put on the card
		picks.push(entry ? { data: entry.data, entry, commits: repo.commits } : { data: fromRepo(repo), commits: repo.commits });
		taken.add(repoKey(repo.url));
	}
	for (const entry of [...entries.filter((e) => e.data.featured), ...entries.filter((e) => !e.data.featured)]) {
		if (taken.has(repoKey(entry.data.repo))) continue;
		picks.push({ data: entry.data, entry, commits: 0 });
		taken.add(repoKey(entry.data.repo));
	}
	return picks.slice(0, count);
}
