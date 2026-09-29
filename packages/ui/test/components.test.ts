import { gradePart } from '@pt/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnswerField,
  CanonicalPanel,
  CorrectAnswer,
  CountdownTimer,
  Figure,
  FlagToggle,
  GradeBadge,
  MathBlock,
  MathInline,
  NavGrid,
  NumericKeypad,
  PartFeedback,
  ProblemBody,
  QuestionCard,
  SeedScrubber,
  toResponse,
  UnitField,
  VariableTable,
} from '../src/lib/index.ts';
import { canonicalInstance, scenario } from './fixtures.ts';

afterEach(() => vi.useRealTimers());

describe('math', () => {
  it('MathInline renders KaTeX inline; MathBlock renders display math', () => {
    const { container } = render(MathInline, { tex: '\\mu_k = 0.32' });
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-display')).toBeNull();
    expect(container.querySelector('annotation')?.textContent).toBe('\\mu_k = 0.32');
    const block = render(MathBlock, { tex: 'x^2' });
    expect(block.container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not throw on bad TeX', () => {
    const { container } = render(MathInline, { tex: '\\frac{' });
    expect(container.querySelector('.katex-error, .katex')).not.toBeNull();
  });
});

describe('ProblemBody', () => {
  const c3 = scenario('c03-luggage-ramp');
  const inst = canonicalInstance(c3);

  it('renders narrative, math, the figure in place and one combined field per part (C3)', () => {
    const { container } = render(ProblemBody, { instance: inst, debounce: 0 });
    const narrative = container.querySelector('.pt-narrative')!;
    expect(narrative.textContent).toContain('A luggage handler pulls a 18-kg suitcase');
    expect(narrative.querySelectorAll('.katex').length).toBe(2); // $F$ and $\mu_k = 0.32$
    expect(narrative.querySelector('img')).toHaveAttribute('alt', expect.stringMatching(/suitcase on a ramp/));
    expect(container.querySelectorAll('.pt-part')).toHaveLength(3);
    expect(screen.getByLabelText('Answer with unit, part 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Answer with unit, part 3')).toBeInTheDocument();
  });

  it('renders a single part on request and reports answers per part', async () => {
    const onanswer = vi.fn();
    render(ProblemBody, { instance: inst, part: 'work-by-friction', onanswer, debounce: 0 });
    const input = screen.getByLabelText('Answer with unit, part 2');
    expect(screen.queryByLabelText('Answer with unit, part 1')).toBeNull();
    await fireEvent.input(input, { target: { value: '-190.8 J' } });
    expect(onanswer).toHaveBeenCalledWith('work-by-friction', { value: '-190.8 J', unit: '' });
  });

  it('renders value-only fields for dimensionless parts, separate unit fields when asked (C10)', () => {
    const c10 = canonicalInstance(scenario('c10-bounce-energy-fraction'));
    render(ProblemBody, { instance: c10 });
    expect(screen.getByLabelText('Answer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unit')).toBeNull();
  });

  it('shows placeholders instead of inputs in readonly mode', () => {
    const { container } = render(ProblemBody, { instance: inst, readonly: true });
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('.pt-slot-placeholder')).toHaveLength(3);
  });

  it('renders vectors in unit-vector notation (C6)', () => {
    const { container } = render(ProblemBody, { instance: canonicalInstance(scenario('c06-vector-work')) });
    const annotations = [...container.querySelectorAll('annotation')].map((a) => a.textContent);
    expect(annotations[0]).toContain('2\\,\\hat{\\imath} + 2\\,\\hat{\\jmath}');
  });
});

describe('Figure', () => {
  it('positions bound overlay labels in percentages and resolves the src', () => {
    const inst = canonicalInstance(scenario('c03-luggage-ramp'));
    const { container } = render(Figure, { figure: inst.figure!, resolveSrc: (s: string) => `/assets/corpus/${s}` });
    expect(container.querySelector('img')).toHaveAttribute('src', '/assets/corpus/figures/placeholder.svg');
    const overlay = container.querySelector<HTMLElement>('[data-overlay="angle"]')!;
    expect(overlay.textContent?.trim()).toBe('31°');
    expect(overlay.style.left).toBe('22%');
    expect(overlay.style.top).toBe('78%');
    expect(overlay.style.transform).toBe('translate(-50%, -50%)');
    expect(container.querySelector('.pt-sr-only')?.textContent).toContain('31°');
  });

  it('renders math in overlays and captions', () => {
    const { container } = render(Figure, {
      figure: {
        id: 'f',
        src: 'a.png',
        alt: 'A wheel.',
        captionHtml: 'Radius <span class="pt-math" data-display="inline" data-tex="R">R</span>',
        overlays: [{ id: 'r', x: 0.5, y: 0.5, anchor: 'start', html: '<span class="pt-math" data-display="inline" data-tex="R = 14">R = 14</span>' }],
      },
    });
    expect(container.querySelector('figcaption .katex')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('[data-overlay="r"]')!.style.transform).toBe('translate(0%, -50%)');
  });
});

describe('AnswerField', () => {
  it('validates on a debounce and previews the parsed expression', async () => {
    vi.useFakeTimers();
    render(AnswerField, { answerType: 'number', debounce: 300, label: 'Energy' });
    const input = screen.getByLabelText('Energy');
    await fireEvent.input(input, { target: { value: '1.152e16' } });
    expect(screen.queryByTestId('answer-preview')).toBeNull(); // not yet
    await vi.advanceTimersByTimeAsync(300);
    const preview = screen.getByTestId('answer-preview');
    expect(preview.querySelector('annotation')?.textContent).toBe('1.152\\times10^{16}');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('flags disallowed input with aria-invalid and a message (numeric rejects functions)', async () => {
    render(AnswerField, { answerType: 'numeric', debounce: 0, label: 'Answer' });
    const input = screen.getByLabelText('Answer');
    await fireEvent.input(input, { target: { value: 'sqrt(0.017^2+0.056^2)' } });
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByRole('alert')).toHaveTextContent('Functions are not allowed here.');
    expect(input).toHaveAccessibleDescription('Functions are not allowed here.');
    await fireEvent.input(input, { target: { value: '0.01*1.70 + 0.01*5.60' } });
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'false'));
    expect(screen.getByTestId('answer-preview').querySelector('annotation')?.textContent).toBe('0.01 \\cdot 1.7 + 0.01 \\cdot 5.6');
  });

  it('numericalFormula accepts functions', async () => {
    render(AnswerField, { answerType: 'numericalFormula', debounce: 0 });
    const input = screen.getByLabelText('Answer');
    await fireEvent.input(input, { target: { value: 'sqrt(2)/2' } });
    await waitFor(() => expect(screen.getByTestId('answer-preview').querySelector('annotation')?.textContent).toBe('\\frac{\\sqrt{2}}{2}'));
  });

  it('combined mode needs a number and a unit', async () => {
    const onchange = vi.fn();
    render(AnswerField, { withUnit: true, debounce: 0, onchange });
    const input = screen.getByLabelText('Answer');
    await fireEvent.input(input, { target: { value: '191.88 J' } });
    await waitFor(() => expect(screen.getByTestId('answer-preview').querySelector('annotation')?.textContent).toBe('191.88\\ \\text{J}'));
    expect(onchange).toHaveBeenLastCalledWith('191.88 J');
    await fireEvent.input(input, { target: { value: '191.88' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Add a unit.'));
    await fireEvent.input(input, { target: { value: '191.88 m/s/s' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This is not a valid unit.'));
  });

  it('accepts translated messages and a custom validator', async () => {
    render(AnswerField, { debounce: 0, messages: { 'identifier-not-allowed': 'Pas de lettres.' } });
    await fireEvent.input(screen.getByLabelText('Answer'), { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Pas de lettres.'));
    const custom = render(AnswerField, { debounce: 0, label: 'Custom', validate: () => ({ ok: false, error: 'budget' }) });
    await fireEvent.input(within(custom.container).getByLabelText('Custom'), { target: { value: '1' } });
    await waitFor(() => expect(within(custom.container).getByRole('alert')).toHaveTextContent('That expression is too complex.'));
  });
});

describe('UnitField / NumericKeypad', () => {
  it('UnitField previews valid units and flags invalid ones', async () => {
    render(UnitField, { debounce: 0 });
    const input = screen.getByLabelText('Unit');
    await fireEvent.input(input, { target: { value: 'm/s^2' } });
    await waitFor(() => expect(input.parentElement!.querySelector('annotation')?.textContent).toBe('\\text{m}/\\text{s}^{2}'));
    await fireEvent.input(input, { target: { value: 'm/s/s' } });
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
  });

  it('NumericKeypad emits keys', async () => {
    const onkey = vi.fn();
    render(NumericKeypad, { onkey });
    await fireEvent.click(screen.getByRole('button', { name: '7' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Times ten to the power' }));
    expect(onkey.mock.calls.map((c) => c[0])).toEqual(['7', 'backspace', 'e']);
  });
});

describe('result display', () => {
  const c1 = scenario('c01-push-work');
  const inst = canonicalInstance(c1);
  const grade = (value: string, unit?: string) => gradePart(c1.parts[0]!, inst.parts[0]!, { value, ...(unit !== undefined && { unit }) });

  it('GradeBadge shows a percentage and a kind', () => {
    expect(render(GradeBadge, { fraction: 1 }).container.querySelector('[data-kind="full"]')).toHaveTextContent('100%');
    expect(render(GradeBadge, { fraction: 0.75 }).container.querySelector('[data-kind="partial"]')).toHaveTextContent('75%');
    expect(render(GradeBadge, { fraction: 0 }).container.querySelector('[data-kind="zero"]')).toHaveTextContent('0%');
  });

  it('PartFeedback explains a result', () => {
    const ok = render(PartFeedback, { result: grade('191.88', 'J') });
    expect(ok.container.querySelector('[data-verdict="correct"]')).toHaveTextContent('Value is correct.');
    const noUnit = render(PartFeedback, { result: grade('191.88') });
    expect(noUnit.container.querySelector('[data-verdict="incorrect"]')).toHaveTextContent('Unit is missing or wrong.');
    const bad = render(PartFeedback, { result: grade('abc', 'J') });
    expect(bad.container).toHaveTextContent('Letters are not allowed here');
  });

  it('CorrectAnswer shows the model answer with its unit', () => {
    const { container } = render(CorrectAnswer, { instance: inst, part: 'work' });
    expect(container.querySelector('annotation')?.textContent).toBe('191.88\\ \\text{J}');
    const c4 = canonicalInstance(scenario('c04-meteor'));
    expect(render(CorrectAnswer, { instance: c4, part: 'kinetic-energy' }).container.querySelector('annotation')?.textContent).toBe(
      '1.152\\times10^{16}\\ \\text{J}',
    );
    const c11 = canonicalInstance(scenario('c11-railroad-cars'));
    expect(render(CorrectAnswer, { instance: c11, part: 'car-count' }).container.querySelector('annotation')?.textContent).toBe('24');
  });

  it('toResponse maps field contents to grading responses', () => {
    expect(toResponse(inst.parts[0]!, { value: '191.88 J', unit: '' })).toEqual({ combined: '191.88 J' });
    expect(toResponse({ slots: [{ index: 0, kind: 'value' }, { index: 0, kind: 'unit' }] }, { value: '1', unit: 'J' })).toEqual({ value: '1', unit: 'J' });
    expect(toResponse(inst.parts[0]!, { value: ' ', unit: '' })).toBeUndefined();
  });
});

describe('shell primitives', () => {
  it('QuestionCard mirrors the target DOM with header / body / footer', () => {
    const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));
    const { container } = render(QuestionCard, {
      header: snip('<span>Question 1</span>'),
      children: snip('<p>Body</p>'),
      footer: snip('<p>Feedback</p>'),
      state: 'answersaved',
    });
    const que = container.querySelector('.que.answersaved')!;
    expect(que.querySelector('.info')).toHaveTextContent('Question 1');
    expect(que.querySelector('.content > .formulation')).toHaveTextContent('Body');
    expect(que.querySelector('.content > .outcome')).toHaveTextContent('Feedback');
    expect(render(QuestionCard, { children: snip('<p>x</p>') }).container.querySelector('.outcome')).toBeNull();
  });

  it('CountdownTimer counts down and fires onExpire once', async () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    const onExpire = vi.fn();
    render(CountdownTimer, { endsAt: t + 65_000, onExpire, now: () => t, interval: 100 });
    expect(screen.getByRole('timer')).toHaveTextContent('1:05');
    t += 64_500;
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByRole('timer')).toHaveTextContent('0:01');
    t += 10_000;
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('NavGrid shows states and selects', async () => {
    const onSelect = vi.fn();
    render(NavGrid, {
      items: [
        { id: 'a', label: '1', answered: true },
        { id: 'b', label: '2', current: true },
        { id: 'c', label: '3', flagged: true },
      ],
      onSelect,
    });
    const [a, b, c] = screen.getAllByRole('button');
    expect(a).toHaveAttribute('data-state', 'answered');
    expect(b).toHaveAttribute('aria-current', 'step');
    expect(b).toHaveAttribute('data-state', 'unanswered');
    expect(c).toHaveClass('flagged');
    expect(c).toHaveAccessibleName('3, not answered, flagged');
    await fireEvent.click(c!);
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('CountdownTimer shows Moodle H:MM:SS and exposes urgency below the warning threshold', async () => {
    vi.useFakeTimers();
    let t = 5_000_000;
    render(CountdownTimer, { endsAt: t + 40 * 60_000 - 1_000, now: () => t, interval: 100, format: 'hms', warnBelowMs: 100_000 });
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('0:39:59');
    expect(timer).not.toHaveClass('low');
    expect(timer.style.getPropertyValue('--pt-urgency')).toBe('0.000');
    t += 40 * 60_000 - 51_000;
    await vi.advanceTimersByTimeAsync(100);
    expect(timer).toHaveTextContent('0:00:50');
    expect(timer).toHaveClass('low');
    expect(timer.style.getPropertyValue('--pt-urgency')).toBe('0.500');
  });

  it('NavGrid shows review outcomes and tooltips', () => {
    render(NavGrid, {
      items: [
        { id: 'a', label: '1', answered: true, outcome: 'correct', title: 'Question 1 - Correct' },
        { id: 'b', label: '2', outcome: 'partial' },
        { id: 'c', label: '3', outcome: 'incorrect', flagged: true },
      ],
    });
    const [a, b, c] = screen.getAllByRole('button');
    expect(a).toHaveAttribute('data-state', 'correct');
    expect(a).toHaveAttribute('title', 'Question 1 - Correct');
    expect(a).toHaveAccessibleName('1, correct');
    expect(b).toHaveAttribute('data-state', 'partial');
    expect(c).toHaveAccessibleName('3, incorrect, flagged');
  });

  it('FlagToggle toggles', async () => {
    const onchange = vi.fn();
    render(FlagToggle, { onchange });
    const btn = screen.getByRole('button', { name: /flag question/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(onchange).toHaveBeenCalledWith(true);
  });
});

describe('editor components', () => {
  it('VariableTable edits rows and shows live variant counts (C3)', async () => {
    const c3 = scenario('c03-luggage-ramp');
    const onchange = vi.fn();
    render(VariableTable, { vars: c3.vars, onchange });
    expect(screen.getByTestId('variant-total')).toHaveTextContent('2,088,450');
    expect(screen.getAllByTestId('var-count').map((c) => c.textContent)).toEqual(['17', '15', '15', '21', '26']);

    await fireEvent.change(screen.getByLabelText('Maximum of m'), { target: { value: '20' } });
    expect(onchange.mock.lastCall![0][0]).toMatchObject({ name: 'm', min: 14, max: 20 });
    expect(screen.getAllByTestId('var-count')[0]).toHaveTextContent('7');

    await fireEvent.click(screen.getByRole('button', { name: '+ Add variable' }));
    expect(onchange.mock.lastCall![0]).toHaveLength(6);
    expect(onchange.mock.lastCall![0][5]).toEqual({ name: 'v1', kind: 'range', min: 1, max: 10, step: 1 });

    await fireEvent.change(screen.getByLabelText('Kind of v1'), { target: { value: 'choice' } });
    expect(onchange.mock.lastCall![0][5]).toEqual({ name: 'v1', kind: 'choice', options: [1, 10] });
    await fireEvent.change(screen.getByLabelText('Options of v1'), { target: { value: '2, 4.5, north' } });
    expect(onchange.mock.lastCall![0][5].options).toEqual([2, 4.5, 'north']);

    await fireEvent.click(screen.getByRole('button', { name: 'Move theta up' }));
    expect(onchange.mock.lastCall![0].map((v: { name: string }) => v.name).slice(0, 2)).toEqual(['theta', 'm']);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove v1' }));
    expect(onchange.mock.lastCall![0]).toHaveLength(5);

    await fireEvent.change(screen.getByLabelText('Significant figures of d'), { target: { value: '2' } });
    expect(onchange.mock.lastCall![0].find((v: { name: string }) => v.name === 'd')).not.toHaveProperty('decimals');
  });

  it('SeedScrubber steps, jumps and randomises', async () => {
    const onchange = vi.fn();
    render(SeedScrubber, { seed: 5, onchange, random: () => 0.5 });
    await fireEvent.click(screen.getByRole('button', { name: 'Next seed' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous seed' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous seed' }));
    await fireEvent.change(screen.getByRole('spinbutton', { name: 'Seed' }), { target: { value: '42' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Random seed' }));
    expect(onchange.mock.calls.map((c) => c[0])).toEqual([6, 5, 4, 42, 2 ** 31]);
    await fireEvent.change(screen.getByRole('spinbutton', { name: 'Seed' }), { target: { value: '-3' } });
    expect(onchange).toHaveBeenLastCalledWith(0);
  });

  it('CanonicalPanel shows per-part pass/fail and turns red on disagreement', () => {
    const c3 = scenario('c03-luggage-ramp');
    const ok = render(CanonicalPanel, { scenario: c3 });
    expect(ok.container.querySelector('header[data-status="pass"]')).toHaveTextContent('Reproduces the source answers');
    expect(ok.container.querySelectorAll('tbody tr[data-part]')).toHaveLength(3);
    expect(ok.container.querySelector('.warnings')).toHaveTextContent('violate constraint');

    const broken = { ...c3, parts: c3.parts.map((p) => (p.id === 'work-by-friction' ? { ...p, answer: '-mu * N' } : p)) };
    const bad = render(CanonicalPanel, { scenario: broken });
    expect(bad.container.querySelector('header[data-status="fail"]')).not.toBeNull();
    expect(bad.container.querySelector('tr.fail[data-part="work-by-friction"]')).toHaveTextContent('-190.796');
  });
});
