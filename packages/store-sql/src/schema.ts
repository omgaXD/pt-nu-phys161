import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema for a future SqlRepository. The scenario document itself is
 * stored as JSON (`doc`, the storable form from `toStorable`); the other
 * columns and tables exist so every ScenarioQuery field pushes down to SQL:
 *
 *   setId      → scenarios.set_id
 *   section    → scenarios.section
 *   tags       → scenario_tags (EXISTS for "any"; GROUP BY … HAVING COUNT = n for "all")
 *   difficulty → scenario_parts.difficulty BETWEEN min AND max (EXISTS)
 *   text       → scenarios.search_text LIKE '%needle%' (lower-cased at write time)
 *   cursor     → keyset on (set_id, position, id)
 */

export const sets = sqliteTable('sets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  sourceDocument: text('source_document'),
  /** JSON array of section names, in order. */
  sections: text('sections', { mode: 'json' }).$type<string[]>().notNull().default([]),
  /** JSON array of scenario ids, or null when the set has no explicit order. */
  scenarioOrder: text('scenario_order', { mode: 'json' }).$type<string[]>(),
});

export const scenarios = sqliteTable(
  'scenarios',
  {
    id: text('id').primaryKey(),
    setId: text('set_id')
      .notNull()
      .references(() => sets.id, { onDelete: 'cascade' }),
    /** Position within the set's display order (derived from sets.scenario_order). */
    position: integer('position').notNull(),
    section: text('section'),
    title: text('title').notNull(),
    /** The storable scenario document (JSON). The source of truth for the row. */
    doc: text('doc', { mode: 'json' }).notNull(),
    /** Lower-cased id, title, narrative, prompts, tags and source labels. */
    searchText: text('search_text').notNull(),
    hasFigure: integer('has_figure', { mode: 'boolean' }).notNull(),
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('scenarios_set_order').on(t.setId, t.position, t.id), index('scenarios_section').on(t.section)],
);

export const scenarioTags = sqliteTable(
  'scenario_tags',
  {
    scenarioId: text('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scenarioId, t.tag] }), index('scenario_tags_tag').on(t.tag)],
);

export const scenarioParts = sqliteTable(
  'scenario_parts',
  {
    scenarioId: text('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    partId: text('part_id').notNull(),
    difficulty: integer('difficulty'),
  },
  (t) => [primaryKey({ columns: [t.scenarioId, t.partId] }), index('scenario_parts_difficulty').on(t.difficulty)],
);

export const assets = sqliteTable(
  'assets',
  {
    setId: text('set_id')
      .notNull()
      .references(() => sets.id, { onDelete: 'cascade' }),
    /** Path relative to the set, exactly as referenced by `figure.src`. */
    path: text('path').notNull(),
    mediaType: text('media_type').notNull(),
    bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.setId, t.path] })],
);

export const schema = { sets, scenarios, scenarioTags, scenarioParts, assets };
