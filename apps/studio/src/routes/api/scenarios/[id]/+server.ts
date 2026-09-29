import {
  checkCanonical,
  ConflictError,
  diagnoseScenario,
  formatIssues,
  NotFoundError,
  safeParseScenario,
  toStorable,
  ValidationError,
} from '@pt/core';
import { error, json } from '@sveltejs/kit';
import { getRepository } from '$lib/server/repository.js';
import type { RequestHandler } from './$types';

/**
 * Save a scenario through the repository. A scenario that fails its
 * canonical check (or has errors) is still saved, but marked `draft`.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const body = (await request.json()) as { setId?: string; isNew?: boolean; scenario?: Record<string, unknown> };
  if (!body.scenario || body.scenario.id !== params.id) error(400, 'scenario id does not match the URL');

  const { draft: _ignored, ...input } = body.scenario;
  const parsed = safeParseScenario(input);
  if (!parsed.ok) {
    return json(
      { message: 'The scenario does not match the schema.', issues: formatIssues(parsed.issues).split('\n') },
      { status: 422 },
    );
  }
  const s = parsed.value;
  const passing = checkCanonical(s).ok && !diagnoseScenario(s).some((d) => d.severity === 'error');
  const toSave = passing ? s : { ...s, draft: true };

  const repo = await getRepository();
  if (body.isNew) {
    try {
      await repo.getScenario(s.id);
      return json({ message: `A scenario with id "${s.id}" already exists.` }, { status: 409 });
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  try {
    await repo.putScenario(toSave, body.setId ? { setId: body.setId } : {});
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ConflictError || e instanceof NotFoundError) {
      return json({ message: e.message }, { status: e instanceof ConflictError ? 409 : 422 });
    }
    throw e;
  }
  return json({ ok: true, draft: !passing, scenario: toStorable(await repo.getScenario(s.id)) });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const repo = await getRepository();
  try {
    await repo.deleteScenario(params.id);
  } catch (e) {
    if (e instanceof NotFoundError) error(404, e.message);
    throw e;
  }
  return json({ ok: true });
};
