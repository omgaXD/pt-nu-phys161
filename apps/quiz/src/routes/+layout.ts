// A static, client-only app: pages are prerendered as empty shells and all
// state (attempts, progress) lives in the browser.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
