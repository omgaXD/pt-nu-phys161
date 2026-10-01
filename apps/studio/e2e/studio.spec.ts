import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { parse } from 'yaml';
import { E2E_ROOT } from './paths';

/** Replace the whole content of a CodeMirror editor. */
async function setEditor(editor: Locator, text: string): Promise<void> {
  const content = editor.locator('.cm-content');
  await content.click();
  await content.press('ControlOrMeta+a');
  await content.pressSequentially(text, { delay: 5 });
}

function formula(page: Page, label: string): Locator {
  return page.locator('.pt-formula-input').filter({ has: page.locator(`.cm-content[aria-label="${label}"]`) });
}

/** Navigate and wait until SvelteKit has hydrated the page. */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('body[data-hydrated]').waitFor();
}

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});
test.afterEach(() => expect(errors).toEqual([]));

test('authors a scenario end to end, sees the canonical check pass, and saves it (M11)', async ({ page }) => {
  await open(page, '/sets/e2e/new');
  await expect(page.getByRole('heading', { name: 'New scenario' })).toBeVisible();

  await page.getByLabel('Scenario id').fill('e2e-incline-normal-force');
  await page.getByRole('textbox', { name: 'Title' }).fill('Normal force on an incline');

  // Narrative: a block on an incline.
  await setEditor(page.locator('.pt-template-editor').first(), 'A block of mass {m:unit} rests on a ramp inclined at {theta}° above the horizontal.');

  // Variables: add theta (degrees) next to the skeleton's m.
  await page.getByRole('button', { name: '+ Add variable' }).click();
  await page.getByLabel('Name', { exact: true }).last().fill('theta');
  await page.getByLabel('Name', { exact: true }).last().press('Tab');
  await page.getByLabel('Minimum of theta').fill('10');
  await page.getByLabel('Minimum of theta').press('Tab');
  await page.getByLabel('Maximum of theta').fill('40');
  await page.getByLabel('Maximum of theta').press('Tab');
  await page.getByLabel('Unit of theta').fill('°');
  await page.getByLabel('Unit of theta').press('Tab');
  await expect(page.getByTestId('variant-total')).toHaveText(String(19 * 31));

  // Part: normal force, with the source's printed answer.
  await page.getByRole('textbox', { name: 'Id', exact: true }).first().fill('normal-force');
  await page.getByRole('textbox', { name: 'Id', exact: true }).first().press('Tab');
  await setEditor(page.locator('.pt-template-editor').nth(1), 'Find the normal force on the block. {_0}{_u}');

  // A wrong formula first: the canonical check fails visibly…
  await setEditor(formula(page, 'Answer formula of part 1'), 'm * g * sin(rad(theta))');
  await page.getByLabel('Source value of m').fill('2');
  await page.getByLabel('Source value of m').press('Tab');
  await page.getByLabel('Source value of theta').fill('30');
  await page.getByLabel('Source value of theta').press('Tab');
  await page.getByLabel('Printed answer 1').fill('16.9741');
  await page.getByLabel('Printed answer 1').press('Tab');
  await page.getByLabel('Source label 1').fill('P999');
  await expect(page.getByTestId('save-status')).toHaveText(/canonical ✗/);
  await expect(page.locator('.pt-canonical-panel header')).toHaveAttribute('data-status', 'fail');

  // …and the right one makes it pass.
  await setEditor(formula(page, 'Answer formula of part 1'), 'm * g * cos(rad(theta))');
  await expect(page.locator('.pt-canonical-panel header')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('.pt-canonical-panel')).toContainText('Reproduces the source answers');
  await expect(page.getByTestId('save-status')).toHaveText('canonical ✓');

  // The live preview renders the problem with the drawn values.
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.locator('.pt-narrative')).toContainText(/A block of mass \d+(\.\d)?\skg rests on a ramp inclined at \d+° above the horizontal\./);
  await expect(preview.getByLabel('Answer with unit')).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/sets/e2e/e2e-incline-normal-force');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' }).or(page.locator('.pt-canonical-panel header[data-status="pass"]'))).toBeVisible();

  const file = join(E2E_ROOT, 'e2e/scenarios/e2e-incline-normal-force.yaml');
  expect(existsSync(file)).toBe(true);
  const saved = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  expect(saved).toMatchObject({
    id: 'e2e-incline-normal-force',
    title: 'Normal force on an incline',
    vars: [expect.objectContaining({ name: 'm' }), expect.objectContaining({ name: 'theta', min: 10, max: 40, unit: '°' })],
    parts: [expect.objectContaining({ id: 'normal-force', answer: 'm * g * cos(rad(theta))' })],
    canonical: { vars: { m: 2, g: 9.8, theta: 30 }, parts: [{ id: 'normal-force', answer: 16.9741, unit: 'N', source: 'P999' }] },
  });
  expect(saved).not.toHaveProperty('draft');

  // Reload: it round-trips through the repository and still passes.
  await page.reload();
  await page.locator('body[data-hydrated]').waitFor();
  await expect(page.locator('.pt-canonical-panel header')).toHaveAttribute('data-status', 'pass');
  await open(page, '/sets/e2e');
  await expect(page.locator('tr[data-scenario="e2e-incline-normal-force"] .pill')).toHaveText('canonical ✓');
});

test('saves a scenario that fails its canonical check as a draft', async ({ page }) => {
  await open(page, '/sets/e2e/new');
  await page.getByLabel('Scenario id').fill('e2e-failing');
  await setEditor(formula(page, 'Answer formula of part 1'), 'm * g * 2');
  await expect(page.getByTestId('save-status')).toHaveText(/will save as draft/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/sets/e2e/e2e-failing');
  const saved = parse(readFileSync(join(E2E_ROOT, 'e2e/scenarios/e2e-failing.yaml'), 'utf8')) as Record<string, unknown>;
  expect(saved.draft).toBe(true);
  await open(page, '/sets/e2e?status=draft');
  await expect(page.locator('tr[data-scenario="e2e-failing"] .pill')).toHaveText('draft');
});

test('turns an imported draft into a passing scenario (pt import → Studio)', async ({ page }) => {
  await open(page, '/sets/demo');
  await page.getByRole('button', { name: 'Show drafts' }).click();
  await page.getByRole('link', { name: 'P1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New scenario from draft P1' })).toBeVisible();
  await page.locator('body[data-hydrated]').waitFor();
  // The draft arrives with suggested ranges and a placeholder answer: it fails.
  await expect(page.locator('.pt-canonical-panel header')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('variant-total')).not.toHaveText('—');
  await setEditor(formula(page, 'Answer formula of part 1'), 'F * d');
  await expect(page.locator('.pt-canonical-panel header')).toHaveAttribute('data-status', 'pass');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/sets/demo/demo-p001');
  const saved = parse(readFileSync(join(E2E_ROOT, 'demo/scenarios/demo-p001.yaml'), 'utf8')) as Record<string, unknown>;
  expect(saved).toMatchObject({ id: 'demo-p001', source: { labels: ['P1'] }, canonical: { parts: [{ answer: 191.88, unit: 'J', source: 'P1' }] } });
  expect(saved).not.toHaveProperty('draft');
});

test('scrubbing the seed re-instantiates instantly; errors show inline without blanking the preview', async ({ page }) => {
  await open(page, '/sets/corpus/c03-luggage-ramp');
  const preview = page.getByRole('region', { name: 'Preview' });
  const narrative = preview.locator('.pt-narrative');
  await expect(narrative).toContainText('A luggage handler pulls a');
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    seen.add((await narrative.textContent()) ?? '');
    await preview.getByRole('button', { name: 'Next seed' }).click();
  }
  expect(seen.size).toBeGreaterThan(3);
  await preview.getByLabel('at source values').check();
  await expect(narrative).toContainText('a 18-kg suitcase up a ramp inclined at 31°');

  // Break a formula: the error appears, the last good preview stays.
  await setEditor(formula(page, 'Answer formula of part 1'), 'F * dd');
  await expect(page.getByTestId('preview-error')).toContainText('dd');
  await expect(narrative).toContainText('a 18-kg suitcase');
  await expect(formula(page, 'Answer formula of part 1')).toHaveClass(/has-error/);
  await setEditor(formula(page, 'Answer formula of part 1'), 'F * d');
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
});

test('the answer field in the preview validates and previews input', async ({ page }) => {
  await open(page, '/sets/corpus/c01-push-work');
  const field = page.getByRole('region', { name: 'Preview' }).getByLabel('Answer with unit');
  await field.fill('191.88 J');
  await expect(page.getByTestId('answer-preview')).toBeVisible();
  await field.fill('sqrt(2) J');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').filter({ hasText: 'Functions are not allowed here.' })).toBeVisible();
});

test('filters the scenario list by section and search', async ({ page }) => {
  await open(page, '/sets/corpus');
  await page.getByLabel('Section').selectOption('Torque');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await open(page, '/sets/corpus?q=meteor');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('the /dev gallery renders every component against the corpus (M10)', async ({ page }) => {
  await open(page, '/dev');
  for (const heading of [
    'MathInline / MathBlock',
    'ProblemBody — C3 (multi-part, shared figure)',
    'Figure',
    'AnswerField',
    'UnitField',
    'NumericKeypad',
    'PartFeedback / GradeBadge / CorrectAnswer / DifficultyDots',
    'QuestionCard',
    'CountdownTimer',
    'NavGrid',
    'VariableTable',
    'FormulaInput',
    'TemplateEditor',
    'SeedScrubber',
    'CanonicalPanel',
  ]) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.pt-difficulty')).toHaveCount(5);
  await expect(page.locator('.pt-canonical-panel header[data-status="pass"]')).toHaveCount(1);
  await expect(page.locator('.pt-canonical-panel header[data-status="fail"]')).toHaveCount(1);
  await expect(page.locator('[data-overlay="angle"]').first()).toHaveText('31°');
  await expect(page.getByRole('timer')).toHaveCount(2);
  const themed = page.getByTestId('moodle-theme');
  await expect(themed.getByRole('timer')).toHaveText(/^\s*0:0[45]:\d\d\s*$/);
  await expect(themed.locator('.que .info h3.no .qno')).toHaveText('1');
  await expect(page.getByRole('navigation', { name: 'Review navigation' }).getByRole('button', { name: '1, correct' })).toHaveAttribute('data-state', 'correct');
});

test('serves figure assets through the repository', async ({ request }) => {
  const res = await request.get('/assets/corpus/figures/placeholder.svg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/svg+xml');
  expect((await request.get('/assets/corpus/../corpus/set.yaml')).status()).toBe(404);
});
