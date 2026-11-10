import { execFileSync } from 'node:child_process';
import { PROJECT_OWNERS } from '../consts';

// Commits in this window decide which projects get the big cards.
export const ACTIVITY_DAYS = 30;

export interface RepoActivity {
	url: string;
	// `owner/name`
	fullName: string;
	name: string;
	description: string;
	language: string;
	topics: string[];
	homepage: string;
	stars: number;
	commits: number;
}

const QUERY = `
query($login: String!, $from: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from) {
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository {
          name nameWithOwner url description homepageUrl stargazerCount isPrivate isFork isArchived
          owner { login }
          primaryLanguage { name }
          repositoryTopics(first: 4) { nodes { topic { name } } }
        }
      }
    }
  }
}`;

function resolveToken(): string | undefined {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) return token;
	try {
		// Local convenience: reuse the gh CLI session.
		return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
	} catch {
		return undefined;
	}
}

// GitHub data is the whole page now, so a deploy without it would publish empty project lists.
function unavailable(reason: string, err?: unknown): RepoActivity[] {
	if (process.env.CI) throw new Error(`[activity] ${reason}`, { cause: err });
	console.warn(`[activity] ${reason}, projects will be empty`, err ?? '');
	return [];
}

// The profile README and the websites get commits every day without being projects.
const isMeta = (name: string, login: string) => name.toLowerCase() === login.toLowerCase() || name.toLowerCase().endsWith('.github.io');

async function load(login: string): Promise<RepoActivity[]> {
	const token = resolveToken();
	if (!token) return unavailable('no GitHub token');
	const owners = new Set(PROJECT_OWNERS.map((o) => o.toLowerCase()));
	const from = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString();
	try {
		const res = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'jihoo12.github.io' },
			body: JSON.stringify({ query: QUERY, variables: { login, from } }),
		});
		const payload = await res.json();
		if (!res.ok || payload.errors) throw new Error(JSON.stringify(payload.errors ?? payload));
		return payload.data.user.contributionsCollection.commitContributionsByRepository
			.filter(
				({ repository: r }: any) =>
					!r.isPrivate && !r.isFork && !r.isArchived && !isMeta(r.name, login) && owners.has(r.owner.login.toLowerCase()),
			)
			.map(({ repository: r, contributions }: any) => ({
				url: r.url,
				fullName: r.nameWithOwner,
				name: r.name,
				description: (r.description ?? '').trim(),
				language: r.primaryLanguage?.name ?? '',
				topics: r.repositoryTopics.nodes.map((n: any) => n.topic.name),
				homepage: r.homepageUrl ?? '',
				stars: r.stargazerCount,
				commits: contributions.totalCount,
			}))
			.filter((r: RepoActivity) => r.commits > 0)
			.sort((a: RepoActivity, b: RepoActivity) => b.commits - a.commits);
	} catch (err) {
		return unavailable('GitHub request failed', err);
	}
}

let cached: Promise<RepoActivity[]> | undefined;

// Most active public repos over the last ACTIVITY_DAYS, busiest first. Fetched once per build.
export function recentActivity(login: string): Promise<RepoActivity[]> {
	return (cached ??= load(login));
}
