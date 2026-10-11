// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}
  /** PUBLIC_REPO_URL at build, or null (vite.config.ts). */
  const __REPO_URL__: string | null;
}

export {};
