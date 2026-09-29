// @pt/core compiles against the ES library only (no DOM, no Node types) so
// that I/O cannot creep in. These two WHATWG globals exist in every runtime we
// target (browsers, Node ≥ 17, workers) and are declared here explicitly.
declare function structuredClone<T>(value: T): T;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
