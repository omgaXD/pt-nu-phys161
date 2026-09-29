import {
  Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  Scalar,
  type ToStringOptions,
} from 'yaml';

/** Serialisation settings. Changing these changes every file's bytes — don't. */
export const STRINGIFY_OPTIONS: ToStringOptions = {
  lineWidth: 100,
  minContentWidth: 40,
  flowCollectionPadding: true,
  indentSeq: true,
};

type Path = readonly (string | number)[];

/** A path pattern where '*' matches any sequence index. */
export type Pattern = readonly (string | '*')[];

const FLOW_PATHS: Pattern[] = [
  ['source'],
  ['tags'],
  ['vars', '*'],
  ['derived', '*'],
  ['parts', '*', 'tolerance'],
  ['parts', '*', 'tags'],
  ['figure', 'overlays', '*'],
  ['canonical', 'vars'],
  ['canonical', 'parts', '*'],
];

const PROSE_KEYS = new Set(['narrative', 'prompt', 'hint', 'solution', 'alt', 'caption', 'description']);

function matches(path: Path, pattern: Pattern): boolean {
  return path.length === pattern.length && pattern.every((p, i) => p === '*' || p === path[i]);
}

/**
 * House style for nodes we create: short records (variables, tolerances,
 * canonical rows) as one-line flow maps; long prose as folded block scalars.
 * Nodes that came from an existing file are never restyled.
 */
function applyStyle(node: unknown, path: Path, flowPaths: readonly Pattern[] = FLOW_PATHS): void {
  if (isMap(node) || isSeq(node)) {
    if (flowPaths.some((p) => matches(path, p))) {
      node.flow = true;
      return; // children inherit flow
    }
    if (isMap(node)) {
      for (const pair of node.items) applyStyle(pair.value, [...path, String((pair.key as Scalar).value)], flowPaths);
    } else {
      node.items.forEach((item, i) => applyStyle(item, [...path, i], flowPaths));
    }
    return;
  }
  if (isScalar(node) && typeof node.value === 'string') {
    const key = path.at(-1);
    const text = node.value;
    if (typeof key === 'string' && PROSE_KEYS.has(key) && text.length > 60 && !/^\s|\s$|\n/.test(text)) {
      node.type = Scalar.BLOCK_FOLDED;
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function identityKey(v: unknown): string | undefined {
  if (!isPlainObject(v)) return undefined;
  if (typeof v.id === 'string') return `id:${v.id}`;
  if (typeof v.name === 'string') return `name:${v.name}`;
  return undefined;
}

function nodeIdentity(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const id = node.get('id');
  if (typeof id === 'string') return `id:${id}`;
  const name = node.get('name');
  if (typeof name === 'string') return `name:${name}`;
  return undefined;
}

function create(doc: Document, value: unknown, path: Path): Node {
  const node = doc.createNode(value) as Node;
  applyStyle(node, path);
  return node;
}

/**
 * Merge `value` into an existing node, preserving comments, key order and
 * scalar styles wherever the data did not change. Sequences of records are
 * matched by `id` (or `name`) so reordering keeps each item's comments.
 */
function merge(doc: Document, node: unknown, value: unknown, path: Path): Node {
  if (isPlainObject(value) && isMap(node)) {
    const keep = new Set(Object.keys(value).filter((k) => value[k] !== undefined));
    node.items = node.items.filter((p) => isPair(p) && keep.has(String((p.key as Scalar).value)));
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const pair = node.items.find((p) => String((p.key as Scalar).value) === k) as Pair<Scalar, Node> | undefined;
      if (pair) pair.value = merge(doc, pair.value, v, [...path, k]);
      else node.items.push(doc.createPair(k, create(doc, v, [...path, k])) as Pair<unknown, unknown>);
    }
    return node;
  }
  if (Array.isArray(value) && isSeq(node)) {
    const byId = new Map<string, unknown>();
    for (const item of node.items) {
      const id = nodeIdentity(item);
      if (id !== undefined && !byId.has(id)) byId.set(id, item);
    }
    const old = node.items;
    node.items = value.map((v, i) => {
      const id = identityKey(v);
      const existing = id !== undefined ? byId.get(id) : old[i];
      return existing !== undefined ? merge(doc, existing, v, [...path, i]) : create(doc, v, [...path, i]);
    });
    return node;
  }
  if (isScalar(node) && !isPlainObject(value) && !Array.isArray(value)) {
    if (node.value !== value) node.value = value;
    return node;
  }
  return create(doc, value, path);
}

export interface NewDocumentOptions {
  /** Comment block at the top of the file. */
  commentBefore?: string;
  /** Extra path patterns ('*' = any index) to write as flow collections. */
  flowPaths?: readonly Pattern[];
}

/** Serialise `value` as a new YAML document in house style. */
export function newDocumentText(value: unknown, opts: NewDocumentOptions = {}): string {
  const doc = new Document(value);
  applyStyle(doc.contents, [], [...FLOW_PATHS, ...(opts.flowPaths ?? [])]);
  if (opts.commentBefore) doc.commentBefore = opts.commentBefore;
  return doc.toString(STRINGIFY_OPTIONS);
}

/**
 * Update existing YAML text to hold `value`. Comments, key order and the
 * formatting of unchanged parts survive; the result is a fixed point
 * (updating it again with the same value returns the same bytes).
 */
export function updateDocumentText(text: string, value: unknown): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return newDocumentText(value, doc.commentBefore ? { commentBefore: doc.commentBefore } : {});
  }
  // A map root is merged in place; only a type change replaces it.
  const root = merge(doc, doc.contents, value, []);
  if (root !== doc.contents) (doc as Document).contents = root;
  return doc.toString(STRINGIFY_OPTIONS);
}
