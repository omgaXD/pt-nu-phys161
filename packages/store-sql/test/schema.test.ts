import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { NotImplementedError, schema, SqlRepository } from '../src/index.ts';

function shape(table: SQLiteTable) {
  const c = getTableConfig(table);
  return {
    name: c.name,
    columns: Object.fromEntries(c.columns.map((col) => [col.name, { type: col.getSQLType(), notNull: col.notNull, pk: col.primary }])),
    primaryKeys: c.primaryKeys.map((pk) => pk.columns.map((col) => col.name)),
    indexes: c.indexes.map((i) => i.config.name).sort(),
    foreignKeys: c.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return `${ref.columns.map((x) => x.name).join(',')} → ${getTableConfig(ref.foreignTable).name}(${ref.foreignColumns.map((x) => x.name).join(',')})`;
    }),
  };
}

describe('@pt/store-sql schema shape', () => {
  it('has the expected tables', () => {
    expect(Object.values(schema).map((t) => getTableConfig(t).name)).toEqual([
      'sets',
      'scenarios',
      'scenario_tags',
      'scenario_parts',
      'assets',
    ]);
  });

  it('sets', () => {
    expect(shape(schema.sets)).toMatchSnapshot();
  });

  it('scenarios: JSON document plus the columns ScenarioQuery pushes down to', () => {
    const s = shape(schema.scenarios);
    expect(Object.keys(s.columns)).toEqual([
      'id',
      'set_id',
      'position',
      'section',
      'title',
      'doc',
      'search_text',
      'has_figure',
      'draft',
      'updated_at',
    ]);
    expect(s.columns.id!.pk).toBe(true);
    expect(s.columns.doc!.notNull).toBe(true);
    expect(s.foreignKeys).toEqual(['set_id → sets(id)']);
    expect(s.indexes).toEqual(['scenarios_section', 'scenarios_set_order']);
  });

  it('tags and parts are normalised for tag / difficulty filters', () => {
    const tags = shape(schema.scenarioTags);
    expect(tags.primaryKeys).toEqual([['scenario_id', 'tag']]);
    expect(tags.indexes).toEqual(['scenario_tags_tag']);
    const parts = shape(schema.scenarioParts);
    expect(parts.primaryKeys).toEqual([['scenario_id', 'part_id']]);
    expect(parts.columns.difficulty!.notNull).toBe(false);
  });

  it('assets are keyed by (set, path) like figure refs', () => {
    const a = shape(schema.assets);
    expect(a.primaryKeys).toEqual([['set_id', 'path']]);
    expect(a.columns.bytes!.type).toBe('blob');
  });
});

describe('SqlRepository stub', () => {
  it('implements the interface but every method is notImplemented()', async () => {
    const repo = new SqlRepository({} as never);
    const calls = [
      () => repo.listSets(),
      () => repo.getSet('x'),
      () => repo.putSet({ id: 'x', title: 'x', sections: [] }),
      () => repo.listScenarios({}),
      () => repo.getScenario('x'),
      () => repo.putScenario({} as never),
      () => repo.deleteScenario('x'),
      () => repo.resolveAsset('x/y'),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(NotImplementedError);
  });

  // When the methods are filled in, replace this with:
  //   describeRepositoryConformance('SqlRepository', async (seed) => ({ repo: await sqliteRepoWith(seed) }));
  it.todo('passes the shared ProblemRepository conformance suite');
});
