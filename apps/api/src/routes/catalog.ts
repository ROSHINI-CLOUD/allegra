import { Router } from 'express';

import type { CatalogService } from '../catalog/catalog.js';
import { sendFailure, sendSuccess, nonNegativeInt, positiveInt, queryString } from './common.js';

export function catalogRouter(catalog: CatalogService): Router {
  const router = Router();

  router.get('/search', async (request, response) => {
    const query = queryString(request.query.q);
    if (!query) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const value = await catalog.search(query, positiveInt(request.query.limit, 20, 50), nonNegativeInt(request.query.page, 0));
      sendSuccess(response, value);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs', async (request, response) => {
    const ids = queryString(request.query.ids)?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
    if (ids.length === 0 || ids.length > 50) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSongs(ids));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs/:id/suggestions', async (request, response) => {
    const id = queryString(request.params.id);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSuggestions(id, positiveInt(request.query.limit, 15, 30)));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs/:id', async (request, response) => {
    const id = queryString(request.params.id);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSong(id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/home', async (_request, response) => {
    try {
      sendSuccess(response, await catalog.getHome());
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}
