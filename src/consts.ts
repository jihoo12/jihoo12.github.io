export const SITE_TITLE = 'Jihoo';
export const SITE_DESCRIPTION = 'A little corner of the internet for things I make, learn, and love.';

export const GITHUB_USER = 'jihoo12';

// Accounts whose repos count as my projects (contributions to other people's repos are left out).
export const PROJECT_OWNERS = [GITHUB_USER, 'jihoolang', 'gloaming-dusk'];

// GitHub doesn't know where a repo is published, so packages are listed here by lowercase `owner/name`.
export const PACKAGES: Record<string, { registry: 'npm' | 'pypi'; name: string }> = {
	'jihoo12/heliograph': { registry: 'npm', name: '@jihoo12/heliograph' },
	'jihoo12/rustanalyser': { registry: 'pypi', name: 'rust-analyzer-db' },
};

export const PROFILES = {
	github: `https://github.com/${GITHUB_USER}`,
	npm: 'https://www.npmjs.com/~jihoo12',
	pypi: 'https://pypi.org/user/jihoo/',
};

export const REGISTRIES = {
	npm: {
		label: 'npm',
		url: (name: string) => `https://www.npmjs.com/package/${name}`,
		install: (name: string) => `npm i ${name}`,
	},
	pypi: {
		label: 'PyPI',
		url: (name: string) => `https://pypi.org/project/${name}/`,
		install: (name: string) => `pip install ${name}`,
	},
};
