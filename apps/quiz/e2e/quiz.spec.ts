import { type Browser, expect, type Page, test } from '@playwright/test';

// Content (see prepare.mjs): set "corpus" = the 21 authored reference scenarios
// (28 source problems over 10 sections, randomized), set "demo" = 7 imported
// drafts played with their source values.

/** Navigate (relative to the /pt/ base) and wait until content is loaded. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
}

async function startFrom(page: Page, query: string): Promise<void> {
  await open(page, query);
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page).toHaveURL(/\/pt\/attempt\/$/);
}

const card = (page: Page) => page.locator('.que');
const nav = (page: Page) => page.locator('section.block[aria-labelledby="quiz-nav-title"]');
const answerField = (page: Page) => card(page).getByRole('textbox');

async function submitAll(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Finish attempt ...' }).first().click();
  await expect(page).toHaveURL(/attempt\/summary\/$/);
  await page.getByRole('button', { name: 'Submit all and finish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit all and finish' }).click();
  await expect(page).toHaveURL(/\/pt\/review\/\?id=/);
}

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('start page: presets set the options, editing makes a custom quiz', async ({ page }) => {
  await open(page, '');
  await expect(page.getByRole('heading', { name: 'Start a quiz' })).toBeVisible();
  const ordered = page.getByRole('button', { name: /^Ordered/ });
  await expect(ordered).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('summary')).toContainText('28 questions · in order · randomized values · no time limit');

  await page.getByRole('button', { name: /^Exam/ }).click();
  await expect(page.getByRole('button', { name: /^Exam/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Number of questions')).toHaveValue('7');
  await expect(page.getByLabel('Time limit in minutes')).toHaveValue('40');
  await expect(page.getByTestId('summary')).toContainText('7 questions · in order · randomized values · 40 min · feedback at the end');

  await page.getByLabel('Time limit in minutes').fill('30');
  await page.getByLabel('Time limit in minutes').blur();
  await expect(page.getByTestId('preset-state')).toContainText('Custom');
  await page.getByRole('button', { name: /^Chaotic/ }).click();
  await expect(page.getByTestId('summary')).toContainText('28 questions · shuffled');

  // Sets and sections filter the pool.
  await page.getByLabel('Demo set').check();
  await expect(page.getByTestId('summary')).toContainText('35 questions');
  await page.locator('details.sections').last().locator('summary').click();
  await page.locator('details.sections').last().getByLabel('Kinetic energy').uncheck();
  await expect(page.getByTestId('summary')).toContainText('32 questions');
});

test('ordered: Check gives immediate feedback and locks a correct answer', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source');
  await expect(card(page).locator('.qno')).toHaveText('1');
  await expect(card(page)).toContainText('66.5');
  await answerField(page).fill('100 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Incorrect');
  await expect(card(page)).toContainText('Please try again.');
  await expect(nav(page).getByRole('button', { name: /^1, incorrect/ })).toBeVisible();

  await answerField(page).fill('191.88 J');
  await answerField(page).press('Enter'); // Enter checks
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await expect(nav(page).getByRole('button', { name: /^1, correct/ })).toHaveAttribute('data-state', 'correct');
  await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
  await expect(answerField(page)).toBeDisabled();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(card(page).locator('.qno')).toHaveText('2');
  await expect(card(page).locator('.source')).toContainText('Reference corpus · P2');
});

test('maxTries locks a wrong answer and shows the correct one', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source&tries=1');
  await expect(card(page)).toContainText('1 try left');
  await answerField(page).fill('100 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Incorrect');
  await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
  await expect(card(page).locator('.rightanswer')).toContainText('The correct answer is');
});

test('Show correct answer locks the question and earns nothing', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=demo');
  await page.getByRole('button', { name: 'Show correct answer' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct answer shown');
  await expect(card(page).locator('.rightanswer')).toContainText('191.88');
  await expect(answerField(page)).toBeDisabled();
  await submitAll(page);
  await expect(page.getByTestId('marks')).toHaveText('0.00/7.00');
  await expect(page.getByTestId('review-summary')).toContainText('1 answer shown');
});

test('exam from a seeded link: 7 problems from different sections, feedback only at the end', async ({ page, request }) => {
  const corpus = (await (await request.get('content/sets/corpus.json')).json()) as { questions: { label: string; section: string }[] };
  const sectionOf = new Map(corpus.questions.map((q) => [q.label, q.section]));

  await open(page, '?p=exam&sets=corpus&seed=42');
  await expect(page.getByRole('button', { name: /^Exam/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(nav(page).getByRole('button')).toHaveCount(7);
  await expect(page.getByRole('timer')).toHaveText(/0:(40:00|39:\d\d)/);
  await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show correct answer' })).toHaveCount(0);

  await answerField(page).fill('12 J');
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByRole('button', { name: 'Flag question' }).click();
  await expect(nav(page).getByRole('button', { name: /^2, not answered, flagged/ })).toHaveClass(/flagged/);

  await page.getByRole('link', { name: 'Finish attempt ...' }).first().click();
  const rows = page.getByTestId('attempt-summary').locator('tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText('Answer saved');
  await expect(rows.nth(1)).toContainText('Not yet answered');
  await page.getByRole('button', { name: 'Submit all and finish' }).click();
  await expect(page.getByRole('dialog')).toContainText('Questions without a response: 6');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit all and finish' }).click();

  await expect(page).toHaveURL(/review\/\?id=/);
  await expect(page.getByTestId('marks')).toHaveText(/^\d\.\d\d\/7\.00$/);
  const labels = (await page.locator('.que .source').allTextContents()).map((t) => /P\d+/.exec(t)![0]);
  expect(labels).toHaveLength(7);
  expect(new Set(labels.map((l) => sectionOf.get(l))).size).toBe(7);
  await expect(page.locator('.que .rightanswer')).toHaveCount(7);

  // The finished attempt is in the history, with a review link.
  await page.getByRole('link', { name: 'Finish review' }).click();
  await expect(page.getByTestId('history').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('history')).toContainText('Exam');
});

test('the timer submits the exam automatically at 40:00', async ({ page }) => {
  await page.clock.install();
  await startFrom(page, '?p=exam&sets=corpus&seed=3');
  await answerField(page).fill('1 J');
  await page.clock.fastForward('40:05');
  await expect(page).toHaveURL(/review\/\?id=/);
  await expect(page.getByTestId('review-summary')).toContainText('time limit reached');
  await expect(page.getByText('Time is up')).toBeVisible();
});

test('reloading keeps the answers, the numbers and the deadline', async ({ page }) => {
  await startFrom(page, '?p=exam&sets=corpus&seed=7');
  const text = await card(page).locator('.formulation').innerText();
  await answerField(page).fill('5 J');
  await page.getByRole('button', { name: 'Next page' }).click(); // saves at once
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
  await expect(card(page).locator('.qno')).toHaveText('2');
  await nav(page).getByRole('button', { name: /^1,/ }).click();
  await expect(answerField(page)).toHaveValue('5 J');
  expect(await card(page).locator('.formulation').innerText()).toBe(text);
  await expect(page.getByRole('timer')).toHaveText(/0:(40:00|39:\d\d)/);

  // The start page offers to continue.
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByTestId('resume')).toContainText('1 of 7 answered');
  await page.getByRole('link', { name: 'Continue the last attempt' }).click();
  await expect(page).toHaveURL(/attempt\/$/);
});

async function examTexts(browser: Browser, seed: number): Promise<string[]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await startFrom(page, `?p=exam&sets=corpus&seed=${seed}`);
  await submitAll(page);
  const texts = await page.locator('.que .formulation').allInnerTexts();
  await context.close();
  return texts;
}

test('a share link reproduces the same questions and numbers in another browser', async ({ browser }) => {
  const a = await examTexts(browser, 1234);
  const b = await examTexts(browser, 1234);
  const c = await examTexts(browser, 999);
  expect(a).toHaveLength(7);
  expect(b).toEqual(a);
  expect(c).not.toEqual(a);
});

test('chaotic order is shuffled', async ({ page }) => {
  await startFrom(page, '?p=chaotic&sets=corpus&seed=5');
  const labels: string[] = [];
  for (let i = 0; i < 5; i++) {
    labels.push(/P\d+/.exec(await card(page).locator('.source').innerText())![0]);
    await page.getByRole('button', { name: 'Next page' }).click();
  }
  const numbers = labels.map((l) => Number(l.slice(1)));
  expect(numbers).not.toEqual([...numbers].sort((x, y) => x - y));
});

test('solved problems are counted and can be skipped', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source');
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.locator('.set-row').filter({ hasText: 'Reference corpus' })).toContainText('1 solved');
  await page.getByLabel('Skip problems I have solved').check();
  await expect(page.getByTestId('summary')).toContainText('27 questions');
});

test('export and import move the attempt and progress to another browser', async ({ page, browser }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source');
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await nav(page).getByRole('button', { name: /^3,/ }).click();
  await answerField(page).fill('12');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export state' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^pt-quiz-state-\d{4}-\d\d-\d\d-\d{4}\.json$/);
  const file = await download.path();

  const context = await browser.newContext();
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(String(e)));
  await open(other, '');
  const corpusRow = other.locator('.set-row').filter({ hasText: 'Reference corpus' });
  await expect(corpusRow).toContainText('0 solved');
  await other.locator('input[type=file]').setInputFiles(file);
  const dialog = other.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Import saved state' })).toBeVisible();
  await expect(dialog.getByLabel('Problem progress')).toBeChecked();
  await expect(dialog).toContainText('1 problem solved, 1 tried');
  await expect(dialog.getByLabel('Current quiz')).toBeChecked();
  await expect(dialog).toContainText('on question 3 of 28, 2 answered');
  await expect(dialog.getByLabel('Finished attempts')).toBeDisabled();
  await expect(dialog.getByLabel('Start-page settings')).toBeChecked();
  await dialog.getByRole('button', { name: 'Import' }).click();

  await expect(other).toHaveURL(/\/pt\/attempt\/$/);
  await expect(card(other).locator('.qno')).toHaveText('3');
  await expect(answerField(other)).toHaveValue('12');
  await expect(nav(other).getByRole('button', { name: /^1, correct/ })).toBeVisible();
  await other.getByRole('link', { name: 'Back' }).click();
  await expect(corpusRow).toContainText('1 solved');
  await expect(other.getByTestId('resume')).toContainText('2 of 28 answered');
  await context.close();
});

test('importing a file that is not a saved state shows why', async ({ page }) => {
  await open(page, '');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('alert')).toHaveText('This is not a saved quiz state.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('figures load (assets under the base path)', async ({ page, request }) => {
  for (const setId of ['corpus', 'demo']) {
    const set = (await (await request.get(`content/sets/${setId}.json`)).json()) as {
      scenarios: Record<string, { scenario: { figure?: { src: string } } }>;
    };
    for (const { scenario } of Object.values(set.scenarios)) {
      if (!scenario.figure) continue;
      const res = await request.get(`content/assets/${setId}/${scenario.figure.src}`);
      expect(res.status(), scenario.figure.src).toBe(200);
    }
  }
  await startFrom(page, '?p=ordered&sets=demo');
  await nav(page).getByRole('button', { name: /^3,/ }).click();
  const img = card(page).locator('img').first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});
