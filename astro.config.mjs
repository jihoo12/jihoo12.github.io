// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
export default defineConfig({
	site: 'https://jihoo12.github.io',
	integrations: [mdx(), sitemap()],
	// Games moved under /games/ when anyone could add one (see CONTRIBUTING.md).
	redirects: { '/cloudhop': '/games/cloudhop/' },
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
