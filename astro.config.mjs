// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
export default defineConfig({
	site: 'https://jihoo12.github.io',
	integrations: [mdx(), sitemap()],
	// Nixchan's world moved to a site of its own, https://jihoo12.github.io/nixchan/ (the jihoo12/nixchan
	// repository, which GitHub Pages serves at /nixchan/). The old addresses lead there.
	redirects: {
		'/island': '/nixchan/island/',
		'/home': '/nixchan/home/',
		'/monochrome': '/nixchan/monochrome/',
		'/experimental': '/nixchan/experimental/',
		'/gallery': '/nixchan/gallery/',
		'/skills': '/nixchan/skills/',
		'/play/cloudhop': '/nixchan/play/cloudhop/',
		'/cloudhop': '/nixchan/play/cloudhop/',
		'/ko/nixchan': '/nixchan/ko/',
	},
});
