// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
export default defineConfig({
	site: 'https://jihoo12.github.io',
	integrations: [mdx(), sitemap()],
	// Games are at /play/<id>/ since anyone could add one (see CONTRIBUTING.md). Not /games/: the
	// jihoo12/games repository has GitHub Pages too, and takes jihoo12.github.io/games/ for itself.
	redirects: { '/cloudhop': '/play/cloudhop/' },
	vite: {
		// Bundle three up front in development. Found one page at a time instead, Vite re-bundles it
		// partway through a session, and a page still holding the old bundle never loads.
		optimizeDeps: {
			include: [
				'three',
				...['geometries/RoundedBoxGeometry', 'loaders/GLTFLoader', 'objects/Reflector', 'postprocessing/EffectComposer', 'postprocessing/OutputPass', 'postprocessing/RenderPass', 'postprocessing/UnrealBloomPass', 'utils/BufferGeometryUtils'].map((m) => `three/examples/jsm/${m}.js`),
			],
		},
	},
});
