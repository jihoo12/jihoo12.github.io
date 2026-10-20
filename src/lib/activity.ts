import { execFileSync } from 'node:child_process';

// Commits in this window decide which projects get the big cards.
export const ACTIVITY_DAYS = 30;

export interface RepoActivity {
	url: string;
	name: string;
	description: string;
	language: string;
	topics: string[];
	commits: number;
}

const QUERY = `
query($login: String!, $from: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from) {
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository {
          name url description isPrivate isFork isArchived
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

// The profile README and the websites get commits every day without being projects.
const isMeta = (name: string, login: string) => name.toLowerCase() === login.toLowerCase() || name.toLowerCase().endsWith('.github.io');

async function load(login: string): Promise<RepoActivity[]> {
	const token = resolveToken();
	if (!token) {
		console.warn('[activity] no GitHub token, using the hand-picked project order');
		return [];
	}
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
			.filter(({ repository: r }: any) => !r.isPrivate && !r.isFork && !r.isArchived && !isMeta(r.name, login))
			.map(({ repository: r, contributions }: any) => ({
				url: r.url,
				name: r.name,
				description: r.description ?? '',
				language: r.primaryLanguage?.name ?? '',
				topics: r.repositoryTopics.nodes.map((n: any) => n.topic.name),
				commits: contributions.totalCount,
			}))
			.filter((r: RepoActivity) => r.commits > 0)
			.sort((a: RepoActivity, b: RepoActivity) => b.commits - a.commits);
	} catch (err) {
		console.warn('[activity] GitHub request failed, using the hand-picked project order:', err);
		return [];
	}
}

let cached: Promise<RepoActivity[]> | undefined;

// Most active public repos over the last ACTIVITY_DAYS, busiest first. Fetched once per build.
export function recentActivity(login: string): Promise<RepoActivity[]> {
	return (cached ??= load(login));
}
