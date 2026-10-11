/** The project's repository, from PUBLIC_REPO_URL at build (vite.config.ts); without it the links to it are hidden. */
export const REPO_URL: string | null = __REPO_URL__;

/** Feedback goes to the repository's issues. */
export const ISSUES_URL = REPO_URL && `${REPO_URL}/issues`;
