export const SITE_TITLE = 'Jihoo';
export const SITE_DESCRIPTION = 'A little corner of the internet for things I make, learn, and love.';

export const GITHUB_USER = 'jihoo12';

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
