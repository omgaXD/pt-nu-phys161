// @pt/ui — presentational Svelte 5 components. Everything renders from a
// ProblemInstance (or a Scenario, for editor components) plus callbacks: no
// data fetching, no stores, no routing.

// Math (KaTeX behind one function, swappable for MathJax)
export { default as MathBlock } from './math/MathBlock.svelte';
export { default as MathInline } from './math/MathInline.svelte';
export { renderTex } from './math/render.js';

// Problem rendering
export { default as Figure } from './problem/Figure.svelte';
export { default as ProblemBody } from './problem/ProblemBody.svelte';
export { default as RichHtml } from './problem/RichHtml.svelte';

// Answer entry
export { default as AnswerField } from './answer/AnswerField.svelte';
export { type AnswerMessages, DEFAULT_MESSAGES, message } from './answer/messages.js';
export { default as NumericKeypad } from './answer/NumericKeypad.svelte';
export { emptyAnswer, type PartAnswer, toResponse } from './answer/types.js';
export { default as UnitField } from './answer/UnitField.svelte';
export { type FieldValidation, validateField, validateUnitField } from './answer/validate.js';

// Result display
export { default as CorrectAnswer } from './result/CorrectAnswer.svelte';
export { DEFAULT_DIFFICULTY_NAMES, type DifficultyNames } from './result/difficulty.js';
export { default as DifficultyDots } from './result/DifficultyDots.svelte';
export { default as GradeBadge } from './result/GradeBadge.svelte';
export { default as PartFeedback } from './result/PartFeedback.svelte';

// Shell primitives (presentational only)
export { default as CountdownTimer } from './shell/CountdownTimer.svelte';
export { default as FlagToggle } from './shell/FlagToggle.svelte';
export { default as NavGrid } from './shell/NavGrid.svelte';
export { default as QuestionCard } from './shell/QuestionCard.svelte';
export type { NavItem } from './shell/types.js';

// Editor components (used by Studio)
export { default as CanonicalPanel } from './editor/CanonicalPanel.svelte';
export {
  type EditorDiagnostic,
  type EvaluationPreview,
  evaluatePreview,
  formulaDiagnostics,
  templateDiagnostics,
} from './editor/diagnostics.js';
export { default as FormulaInput } from './editor/FormulaInput.svelte';
export { default as SeedScrubber } from './editor/SeedScrubber.svelte';
export { default as TemplateEditor } from './editor/TemplateEditor.svelte';
export { default as VariableTable } from './editor/VariableTable.svelte';
