import { Router, type Request, type Response } from 'express';

import { bearerToken } from '../auth/auth.js';
import type { AuthService } from '../auth/auth.js';
import { sendSuccess } from './common.js';

export function authRouter(auth: AuthService): Router {
  const router = Router();

  const createGuest = async (_request: Request, response: Response): Promise<void> => {
    sendSuccess(response, await auth.createGuest());
  };
  router.post('/auth/anon', createGuest);
  router.post('/auth/guest', createGuest);

  router.get('/auth/me', async (request, response) => {
    const userId = getUserId(auth, request);
    if (!userId) {
      sendUnauthorized(response);
      return;
    }
    const user = await auth.getUser(userId);
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    sendSuccess(response, user);
  });

  return router;
}

export function getUserId(auth: AuthService, request: Request): string | null {
  const token = bearerToken(request.header('authorization'));
  return token ? auth.verify(token)?.userId ?? null : null;
}

export function sendUnauthorized(response: Response): void {
  response.status(401).json({ success: false, data: null, error: 'Please start a guest session first.' });
}
