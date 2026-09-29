// @pt/quiz compiles against the ES library only (no DOM, no Node types). These
// WHATWG globals exist in every runtime we target (browsers, Node ≥ 19) and
// are declared here explicitly.
declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | [string, string][]);
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  toString(): string;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
declare const crypto: { getRandomValues<T extends Uint32Array>(array: T): T };
