import { GITHUB_USER, PACKAGES } from '../consts';
import { recentActivity, type RepoActivity } from './activity';

export interface ProjectData {
	title: string;
	// First sentence of the GitHub description, for compact cards.
	tagline: string;
	// The whole GitHub description, for detailed cards.
	description: string;
	language: string;
	tags: string[];
	repo: string;
	homepage: string;
	stars: number;
	package?: { registry: 'npm' | 'pypi'; name: string };
}

export interface RankedProject {
	data: ProjectData;
	// Commits in the activity window; the ranking key.
	commits: number;
}

function firstSentence(text: string): string {
	const match = text.match(/^.+?[.!?](?=\s|$)/s);
	return (match ? match[0] : text).trim();
}

function fromRepo(repo: RepoActivity): ProjectData {
	return {
		title: repo.name,
		tagline: firstSentence(repo.description),
		description: repo.description,
		language: repo.language,
		tags: repo.topics.slice(0, 3),
		repo: repo.url,
		homepage: repo.homepage,
		stars: repo.stars,
		package: PACKAGES[repo.fullName.toLowerCase()],
	};
}

// Every public project with commits in the activity window, busiest first.
// Repos without a GitHub description have nothing to put on a card, so they're skipped.
export async function rankedProjects(): Promise<RankedProject[]> {
	return (await recentActivity(GITHUB_USER))
		.filter((repo) => repo.description)
		.map((repo) => ({ data: fromRepo(repo), commits: repo.commits }));
}

// The busiest `count` projects get the big cards.
export async function featuredProjects(count: number): Promise<RankedProject[]> {
	return (await rankedProjects()).slice(0, count);
}
