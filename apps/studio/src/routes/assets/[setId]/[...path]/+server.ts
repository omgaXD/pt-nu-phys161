import { assetRef, NotFoundError, ValidationError } from '@pt/core';
import { error } from '@sveltejs/kit';
import { getRepository } from '$lib/server/repository.js';
import type { RequestHandler } from './$types';

/** Figure files, resolved through the repository (never by path). */
export const GET: RequestHandler = async ({ params }) => {
  const repo = await getRepository();
  try {
    const asset = await repo.resolveAsset(assetRef(params.setId, params.path));
    const bytes = await asset.read();
    return new Response(new Blob([bytes as BlobPart]), {
      headers: { 'content-type': asset.mediaType, 'cache-control': 'no-cache' },
    });
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ValidationError) error(404, 'Not found');
    throw e;
  }
};
