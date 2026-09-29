import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * A fully static site: every page is a client-rendered shell, and the content
 * is JSON under static/content (written by `pt bundle`).
 *
 * BASE_PATH serves it from a sub-path (e.g. GitHub Pages: /<repo>).
 * PT_QUIZ_ASSETS points the static directory elsewhere (end-to-end tests).
 */
/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html' }),
    paths: { base: process.env.BASE_PATH ?? '' },
    ...(process.env.PT_QUIZ_ASSETS && { files: { assets: process.env.PT_QUIZ_ASSETS } }),
  },
};
