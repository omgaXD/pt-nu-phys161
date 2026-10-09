import { type Browser, expect, type Page, test } from '@playwright/test';
import { ISSUES_URL, REPO_URL } from '../src/lib/repo';

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

/** Open "Advanced options" on the start page (remembered, so it may be open already). */
async function showOptions(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Advanced options' });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
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
  const practice = page.getByRole('button', { name: /^Practice/ });
  await expect(practice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('summary')).toContainText('28 questions · in order · randomized values · no time limit');

  await page.getByRole('button', { name: /^Exam/ }).click();
  await expect(page.getByRole('button', { name: /^Exam/ })).toHaveAttribute('aria-pressed', 'true');
  await showOptions(page);
  await expect(page.getByLabel('Number of questions')).toHaveValue('7');
  await expect(page.getByLabel('Time limit in minutes')).toHaveValue('40');
  await expect(page.getByTestId('summary')).toContainText('7 questions · shuffled · randomized values · 40 min · feedback at the end');

  await page.getByLabel('Time limit in minutes').fill('30');
  await page.getByLabel('Time limit in minutes').blur();
  await expect(page.getByTestId('preset-state')).toContainText('Custom');

  // Nightmare is Exam with difficulty 3–5 only.
  await page.getByRole('button', { name: /^Nightmare/ }).click();
  await expect(page.getByLabel('Lowest difficulty')).toHaveValue('3');
  await expect(page.getByTestId('summary')).toContainText('Nightmare: 7 questions · shuffled · randomized values · difficulty 3–5 · 40 min');
  await page.getByRole('button', { name: /^Easy to Hard/ }).click();
  await expect(page.getByLabel('Lowest difficulty')).toHaveValue('1');
  await expect(page.getByTestId('summary')).toContainText('Easy to Hard: 28 questions · easy to hard · randomized values · no time limit');
  await page.getByRole('button', { name: /^Chaotic/ }).click();
  await expect(page.getByTestId('summary')).toContainText('28 questions · shuffled');

  // Sets and sections filter the pool.
  await page.getByLabel('Demo set').check();
  await expect(page.getByTestId('summary')).toContainText('35 questions');
  await page.locator('details.sections').last().locator('summary').click();
  await page.locator('details.sections').last().getByLabel('Kinetic energy', { exact: true }).uncheck();
  await expect(page.getByTestId('summary')).toContainText('32 questions');

  // Problems are picked inside a section: leaving one out shrinks the pool, and share links carry it.
  const corpus = page.locator('details.sections').first();
  await corpus.locator('summary').click();
  await corpus.getByRole('button', { name: /^Expand / }).first().click();
  const tile = corpus.locator('.problem-picker .pt-nav-item').first();
  await expect(corpus.locator('.problem-picker .pt-nav-grid').first()).toHaveCSS('column-gap', '6px'); // as Moodle's quiz navigation
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('summary')).toContainText('31 questions');
  await expect(corpus.locator('summary')).toContainText('27 of 28 problems');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page).toHaveURL(/ex\.corpus=P\d+/);
});

test('start page: advanced options start collapsed, are remembered, and show when they are custom', async ({ page }) => {
  await open(page, '?p=exam&sets=corpus');
  const toggle = page.getByRole('button', { name: 'Advanced options' });
  const heading = page.getByRole('heading', { name: /^Advanced options/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Number of questions')).toHaveCount(0);
  await expect(page.getByTestId('summary')).toContainText('7 questions · shuffled · randomized values · 40 min');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Time limit in minutes').fill('30');
  await page.getByLabel('Time limit in minutes').blur();
  await expect(heading).not.toContainText('Custom'); // the options are in view
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // Collapsed, a custom quiz still says so next to the heading.
  await page.getByLabel('Time limit in minutes').fill('30');
  await page.getByLabel('Time limit in minutes').blur();
  await toggle.click();
  await expect(page.getByLabel('Time limit in minutes')).toHaveCount(0);
  await expect(heading).toContainText('Custom');
  await page.getByRole('button', { name: /^Exam/ }).click();
  await expect(heading).not.toContainText('Custom');
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('start page: a number or no limit, the field picking its option', async ({ page }) => {
  await open(page, '?p=ordered&sets=corpus');
  await showOptions(page);
  const summary = page.getByTestId('summary');
  const questions = page.getByRole('radiogroup', { name: 'Questions' });
  const tries = page.getByRole('radiogroup', { name: 'Tries' });
  const time = page.getByRole('radiogroup', { name: 'Time limit' });

  // Clicking the field picks "A sample of" with the number shown.
  await expect(questions.getByRole('radio', { name: 'All selected problems' })).toBeChecked();
  await page.getByLabel('Number of questions').click();
  await expect(questions.getByRole('radio', { name: 'A sample of' })).toBeChecked();
  await expect(summary).toContainText('7 questions');
  await questions.getByRole('radio', { name: 'All selected problems' }).check();
  await expect(summary).toContainText('28 questions');

  // Typing a number picks it too.
  await page.getByLabel('Tries per question').fill('2');
  await page.getByLabel('Tries per question').blur();
  await expect(tries.getByRole('radio', { name: 'Up to' })).toBeChecked();
  await expect(summary).toContainText('Check after each (2 tries)');
  await tries.getByRole('radio', { name: 'Unlimited' }).check();
  await expect(summary).not.toContainText('tries');
  await tries.getByRole('radio', { name: 'Up to' }).check();
  await expect(summary).toContainText('Check after each (3 tries)');

  await expect(time.getByRole('radio', { name: 'None' })).toBeChecked();
  await time.getByRole('radio', { name: 'Up to' }).check();
  await expect(page.getByLabel('Time limit in minutes')).toHaveValue('40');
  await expect(summary).toContainText('40 min');
  await time.getByRole('radio', { name: 'None' }).check();
  await expect(summary).toContainText('no time limit');
});

test('practice: Check gives immediate feedback and locks a correct answer', async ({ page }) => {
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

  // The right value without its unit earns part of the mark, and the summary shows it.
  await answerField(page).fill('233.232');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Partially correct');
  await page.getByRole('link', { name: 'Finish attempt ...' }).first().click();
  const rows = page.getByTestId('attempt-summary').locator('tbody tr');
  await expect(rows.nth(0).locator('td').nth(2)).toHaveText('1.00');
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('Partially correct');
  await expect(rows.nth(1).locator('td').nth(2)).toHaveText(/^0\.(?!00)\d\d$/);
  await expect(rows.nth(2).locator('td').nth(2)).toHaveText('');
});

test('maxTries locks a wrong answer and shows the correct one', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source&tries=1');
  await expect(card(page)).toContainText('1 try left');
  await answerField(page).fill('100 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Incorrect');
  await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
  await expect(card(page).locator('.pt-part-correct-answer')).toContainText('One possible correct answer is');

  // Reset starts the question over: an empty, focused field, Check and the tries back, no feedback.
  const reset = card(page).getByRole('button', { name: 'Reset' });
  await expect(reset).toHaveClass(/btn-outline-secondary/);
  await reset.click();
  await expect(card(page).locator('.state')).toHaveText('Not yet answered');
  await expect(answerField(page)).toBeEnabled();
  await expect(answerField(page)).toHaveValue('');
  await expect(answerField(page)).toBeFocused();
  await expect(card(page)).toContainText('1 try left');
  await expect(page.getByRole('button', { name: 'Show correct answer' })).toBeVisible();
  await expect(reset).toHaveCount(0);
  await expect(card(page).locator('.outcome, .pt-part-outcome, .pt-outcome-icon')).toHaveCount(0);
  await answerField(page).fill('191.88 J');
  await answerField(page).press('Enter');
  await expect(card(page).locator('.state')).toHaveText('Correct');
});

test('Show correct answer locks the question and earns nothing', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=demo');
  await page.getByRole('button', { name: 'Show correct answer' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct answer shown');
  await expect(card(page).locator('.pt-part-correct-answer')).toContainText('191.88');
  await expect(answerField(page)).toBeDisabled();
  await expect(card(page).locator('.pt-difficulty')).toHaveCount(0); // demo problems are unrated
  await card(page).getByRole('button', { name: 'Reset' }).click();
  await expect(card(page).locator('.state')).toHaveText('Not yet answered');
  await expect(card(page).locator('.pt-part-correct-answer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show correct answer' }).click();
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
  const flag = card(page).getByRole('button', { name: 'Flagged', exact: true });
  await expect(flag).toHaveText('Flag question');
  await expect(flag).toHaveAttribute('title', 'Flag this question for future reference');
  await flag.click();
  await expect(flag).toHaveAttribute('aria-pressed', 'true');
  await expect(flag).toHaveText('Remove flag');
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
  await expect(page.locator('.que .pt-part-correct-answer')).toHaveCount(7);

  // Flags stay editable in the review, and are kept.
  const reviewFlag = (n: number) => page.locator(`#question-${n}`).getByRole('button', { name: 'Flagged', exact: true });
  await expect(reviewFlag(2)).toHaveText('Remove flag');
  await expect(nav(page).getByRole('button', { name: /^2, not answered, flagged/ })).toHaveClass(/flagged/);
  await reviewFlag(2).click();
  await reviewFlag(3).click();
  await expect(nav(page).getByRole('button', { name: /^2, not answered$/ })).not.toHaveClass(/flagged/);
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
  await expect(reviewFlag(2)).toHaveText('Flag question');
  await expect(reviewFlag(3)).toHaveText('Remove flag');
  await expect(nav(page).getByRole('button', { name: /^3, .*, flagged$/ })).toHaveClass(/flagged/);

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

test('the history offers a review only for attempts that can still be opened', async ({ page }) => {
  await startFrom(page, '?p=exam&sets=corpus&seed=5');
  await submitAll(page);
  const key = `pt:v1:attempt:${new URL(page.url()).searchParams.get('id')}`;
  const review = page.getByTestId('history').getByRole('link', { name: 'Review' });

  // Saved before `exclude` was part of the configuration: it still opens.
  await page.evaluate((k) => {
    const a = JSON.parse(localStorage.getItem(k)!);
    delete a.config.exclude;
    localStorage.setItem(k, JSON.stringify(a));
  }, key);
  await open(page, '');
  await review.click();
  await expect(page.getByTestId('marks')).toHaveText('0.00/7.00');
  await expect(page.getByRole('link', { name: 'Start again with the same options' })).toHaveAttribute('href', /p=exam/);

  // Damaged: listed, but without a review link.
  await page.evaluate((k) => localStorage.setItem(k, '{"format":1}'), key);
  await open(page, '');
  const history = page.getByTestId('history');
  await expect(history.locator('tbody tr')).toHaveCount(1);
  await expect(history.getByRole('columnheader', { name: 'Review' })).toBeVisible();
  await expect(history.getByRole('columnheader', { name: 'Grade / 10.00' })).toBeVisible();
  await expect(history.locator('tbody tr').first().locator('td').nth(4)).toHaveText('0.00');
  await expect(review).toHaveCount(0);
  await expect(history.locator('tbody tr').first()).toContainText('Unavailable');

  // Past the attempts kept in full, only the summary is left: it says so.
  await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('pt:v1:history')!) as { full: boolean }[];
    localStorage.setItem('pt:v1:history', JSON.stringify(entries.map((h) => ({ ...h, full: false }))));
  });
  await open(page, '');
  await expect(history.locator('tbody tr').first()).toContainText('Not kept');
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
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('resume')).toContainText('1 of 7 answered');
  await page.getByRole('link', { name: 'Continue the last attempt' }).click();
  await expect(page).toHaveURL(/attempt\/$/);
});

test('abandoning the attempt in progress asks first', async ({ page }) => {
  await startFrom(page, '?p=exam&sets=corpus&seed=7');
  await open(page, '');
  const resume = page.getByTestId('resume');
  const asked: string[] = [];
  page.on('dialog', (d) => {
    asked.push(d.message());
    void (asked.length === 1 ? d.dismiss() : d.accept());
  });
  await resume.getByRole('button', { name: 'Abandon it' }).click();
  expect(asked).toEqual(['Abandon the attempt in progress? Its answers are lost.']);
  await expect(resume).toBeVisible();
  await resume.getByRole('button', { name: 'Abandon it' }).click();
  await expect(resume).toHaveCount(0);
  await expect(page.getByTestId('history')).toHaveCount(0);
});

test('the next quiz does not reuse the seed of a link', async ({ page }) => {
  await startFrom(page, '?p=exam&sets=corpus&seed=42');
  await open(page, '');
  await expect(page.getByRole('button', { name: /^Exam/ })).toHaveAttribute('aria-pressed', 'true');
  await showOptions(page);
  await expect(page.getByLabel('Seed')).toHaveValue('');

  // Remembered by an older version: dropped too.
  await page.evaluate(() => {
    const { config } = JSON.parse(localStorage.getItem('pt:v1:prefs')!);
    localStorage.setItem('pt:v1:prefs', JSON.stringify({ config: { ...config, seed: 42 } }));
  });
  await open(page, '');
  await expect(page.getByLabel('Seed')).toHaveValue('');
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

test('solved problems are counted and left out on request, as exclusions a link carries', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source');
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.locator('.set-row').filter({ hasText: 'Reference corpus' })).toContainText('1 solved');
  await expect(page.getByTestId('summary')).toContainText('28 questions');
  const corpus = page.locator('details.sections').first();
  await corpus.locator('summary').click();
  await corpus.getByRole('button', { name: 'Leave out solved (1)' }).click();
  await expect(page.getByTestId('summary')).toContainText('27 questions');
  await expect(corpus.getByRole('button', { name: 'Leave out solved (0)' })).toBeDisabled();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page).toHaveURL(/[?&]ex\.corpus=P\d+/);

  // Options saved by an older version with "Skip problems I have solved" on: those problems are left out.
  await page.evaluate(() => {
    const { config } = JSON.parse(localStorage.getItem('pt:v1:prefs')!);
    localStorage.setItem('pt:v1:prefs', JSON.stringify({ config: { ...config, skipSolved: true } }));
  });
  await open(page, '');
  await expect(page.getByTestId('summary')).toContainText('27 questions');
});

test('difficulty: the start page filters by a range, unrated problems only if asked', async ({ page }) => {
  // Corpus: 28 rated problems, 5 of them at 4–5; demo: 7 unrated.
  await open(page, '?p=ordered&sets=corpus,demo');
  await expect(page.getByTestId('summary')).toContainText('35 questions');
  await showOptions(page);
  await expect(page.getByLabel('Also include problems without a difficulty')).toHaveCount(0);
  await page.getByLabel('Lowest difficulty').selectOption('4');
  await expect(page.getByTestId('summary')).toContainText('5 questions · in order · randomized values · difficulty 4–5 ·');
  await expect(page.getByTestId('preset-state')).toContainText('Custom');
  await page.getByLabel('Also include problems without a difficulty').check();
  await expect(page.getByTestId('summary')).toContainText('12 questions');
  await expect(page.getByTestId('summary')).toContainText('difficulty 4–5 (+ unrated)');
  // A bound crossing the other one moves it along.
  await page.getByLabel('Highest difficulty').selectOption('2');
  await expect(page.getByLabel('Lowest difficulty')).toHaveValue('2');
  await page.getByLabel('Lowest difficulty').selectOption('1');
  await page.getByLabel('Highest difficulty').selectOption('5');
  await expect(page.getByTestId('summary')).toContainText('35 questions');
  await expect(page.getByTestId('summary')).not.toContainText('difficulty');

  // A link carries the range.
  await open(page, '?p=ordered&sets=corpus&diff=2-2');
  await expect(page.getByLabel('Lowest difficulty')).toHaveValue('2');
  await expect(page.getByLabel('Highest difficulty')).toHaveValue('2');
  await expect(page.getByTestId('summary')).toContainText('14 questions');
});

test('difficulty stays hidden until a question is settled, then shows as dots with a tooltip', async ({ page }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source&tries=2');
  const dots = card(page).locator('.pt-difficulty');
  await expect(dots).toHaveCount(0);
  await answerField(page).fill('100 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Incorrect');
  await expect(dots).toHaveCount(0); // a try is left
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await expect(dots).toHaveAttribute('aria-label', 'Very easy, 1 of 5');
  await expect(dots.locator('.dot.on')).toHaveCount(1);
  await expect(dots).toHaveAttribute('data-tooltip', 'Very easy');
  const tooltipShown = (): Promise<boolean> => dots.evaluate((el) => getComputedStyle(el, '::before').display === 'block');
  expect(await tooltipShown()).toBe(false);
  await dots.hover();
  expect(await tooltipShown()).toBe(true);
  // Reset: unsettled again, so the difficulty hides.
  await card(page).getByRole('button', { name: 'Reset' }).click();
  await expect(dots).toHaveCount(0);
  await expect(card(page)).toContainText('2 tries left');
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(dots).toHaveCount(1);

  // Answer shown: settled.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(dots).toHaveCount(0);
  await page.getByRole('button', { name: 'Show correct answer' }).click();
  await expect(dots).toHaveCount(1);

  // Out of tries: settled.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(dots).toHaveCount(0);
  await answerField(page).fill('1 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page)).toContainText('1 try left');
  await expect(dots).toHaveCount(0);
  await answerField(page).fill('2 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
  await expect(dots).toHaveCount(1);
});

test('an exam never shows difficulty before it is finished; the review does', async ({ page }) => {
  await startFrom(page, '?p=exam&sets=corpus&seed=42');
  for (let i = 1; i <= 7; i++) {
    await expect(card(page).locator('.qno')).toHaveText(String(i));
    await expect(page.locator('.pt-difficulty')).toHaveCount(0);
    if (i < 7) await page.getByRole('button', { name: 'Next page' }).click();
  }
  await page.getByRole('link', { name: 'Finish attempt ...' }).first().click();
  await expect(page).toHaveURL(/attempt\/summary\/$/);
  await expect(page.locator('.pt-difficulty')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit all and finish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit all and finish' }).click();
  await expect(page).toHaveURL(/review\/\?id=/);
  await expect(page.locator('.que .pt-difficulty')).toHaveCount(7);
});

test('difficulty orders: easy to hard or hard to easy, explained by a tooltip', async ({ page }) => {
  await open(page, '?p=ordered&sets=corpus');
  await showOptions(page);
  const easy = page.locator('label.pt-tooltip').filter({ hasText: 'Easy to hard' });
  await expect(easy).toHaveAttribute('data-tooltip', 'Shuffled within each difficulty level. Problems without a difficulty come last.');
  await expect(page.getByRole('radio', { name: 'Easy to hard' })).toHaveAccessibleDescription(/Shuffled within each difficulty level/);
  const tooltipShown = (): Promise<boolean> => easy.evaluate((el) => getComputedStyle(el, '::before').display === 'block');
  expect(await tooltipShown()).toBe(false);
  await easy.hover();
  expect(await tooltipShown()).toBe(true);
  await page.getByRole('radio', { name: 'Easy to hard' }).check();
  await expect(page.getByTestId('summary')).toContainText('28 questions · easy to hard');
  await expect(page.getByRole('button', { name: /^Easy to Hard/ })).toHaveAttribute('aria-pressed', 'true');

  // The review shows the levels: they never go down (or up).
  for (const [order, sorted] of [['easy-first', (a: number, b: number) => a - b], ['hard-first', (a: number, b: number) => b - a]] as const) {
    await startFrom(page, `?p=exam&sets=corpus&seed=42&order=${order}`);
    await submitAll(page);
    const levels = (await page.locator('.que .pt-difficulty').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-level')))));
    expect(levels).toHaveLength(7);
    expect(levels).toEqual([...levels].sort(sorted));
    expect(new Set(levels).size).toBeGreaterThan(1);
  }
});

test('the course index: sections collapse from their whole title row, remembered', async ({ page }) => {
  await open(page, '');
  const index = page.locator('.drawer-left .courseindex');
  const data = index.getByRole('button', { name: 'Data' });
  const exportLink = index.getByRole('button', { name: 'Export state' });
  await expect(data).toHaveAttribute('aria-expanded', 'true');
  await expect(exportLink).toBeVisible();
  await expect(index.getByRole('button', { name: 'Import state' })).toBeVisible();
  // The title text collapses it too, not only the chevron.
  await data.locator('.courseindex-link').click();
  await expect(data).toHaveAttribute('aria-expanded', 'false');
  await expect(exportLink).toHaveCount(0);
  await expect(index.getByRole('link', { name: 'About' })).toBeVisible(); // General stays open
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
  await expect(data).toHaveAttribute('aria-expanded', 'false');
  await data.locator('.courseindex-chevron').click();
  await expect(data).toHaveAttribute('aria-expanded', 'true');
  await expect(exportLink).toBeVisible();
});

test('the course index: "General" links to the About page and the GitHub repository', async ({ page }) => {
  await open(page, '');
  const index = page.locator('.drawer-left .courseindex');
  await expect(index.getByRole('button', { name: 'General' })).toHaveAttribute('aria-expanded', 'true');
  await expect(index.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', REPO_URL);
  await expect(index.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', ISSUES_URL);
  const about = index.getByRole('link', { name: 'About' });
  await expect(about).not.toHaveAttribute('aria-current');
  await about.click();
  await expect(page).toHaveURL(/\/pt\/about\/$/);
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
  // The current page's leaf is highlighted, as in Moodle.
  await expect(about).toHaveAttribute('aria-current', 'page');
  await expect(index.locator('.pageitem')).toHaveText('About');
});

test('export and import move the attempt and progress to another browser', async ({ page, browser }) => {
  await startFrom(page, '?p=ordered&sets=corpus&values=source');
  await answerField(page).fill('191.88 J');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(card(page).locator('.state')).toHaveText('Correct');
  await nav(page).getByRole('button', { name: /^3,/ }).click();
  await answerField(page).fill('12');
  // App-wide actions are leaves of the course index (left drawer).
  const exportLink = page.locator('.drawer-left .courseindex').getByRole('button', { name: 'Export state' });
  const [download] = await Promise.all([page.waitForEvent('download'), exportLink.click()]);
  expect(download.suggestedFilename()).toMatch(/^pt-quiz-state-\d{4}-\d\d-\d\d-\d{4}\.json$/);
  const file = await download.path();

  const context = await browser.newContext();
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(String(e)));
  await open(other, '');
  await expect(other.locator('.drawer-right')).toHaveCount(0); // the start page has no block drawer
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
  await expect(other.getByRole('alert')).toHaveText('The saved state was imported.');

  await expect(other).toHaveURL(/\/pt\/attempt\/$/);
  await expect(card(other).locator('.qno')).toHaveText('3');
  await expect(answerField(other)).toHaveValue('12');
  await expect(nav(other).getByRole('button', { name: /^1, correct/ })).toBeVisible();
  await other.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(corpusRow).toContainText('1 solved');
  await expect(other.getByTestId('resume')).toContainText('2 of 28 answered');
  await context.close();
});

test('importing a file that is not a saved state shows why', async ({ page }) => {
  await open(page, '');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  const toast = page.getByRole('alert');
  await expect(toast).toHaveText('This is not a saved quiz state.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await toast.getByRole('button', { name: 'Dismiss this notification' }).click();
  await expect(toast).toHaveCount(0);
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
