import { Router, type Request, type Response } from 'express';

import { bearerToken } from '../auth/auth.js';
import type { AuthService } from '../auth/auth.js';
import { normalizeEmail, validPassword } from '../auth/password.js';
import type { UserData } from '../user/store.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

/** What the browser may know about an account. Never the hash. */
export function publicProfile(user: UserData): {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly createdAt: string;
  readonly displayName?: string;
  readonly email?: string;
} {
  return {
    userId: user.userId,
    isGuest: user.isGuest,
    createdAt: user.createdAt,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {})
  };
}

export function authRouter(auth: AuthService): Router {
  const router = Router();

  const createGuest = async (_request: Request, response: Response): Promise<void> => {
    try {
      sendSuccess(response, await auth.createGuest());
    } catch (error) {
      sendFailure(response, error);
    }
  };
  router.post('/auth/anon', createGuest);
  router.post('/auth/guest', createGuest);

  router.post('/auth/register', async (request, response) => {
    const body = asRecord(request.body);
    const email = normalizeEmail(body.email);
    if (!email) {
      response.status(400).json({ success: false, data: null, error: 'Enter a valid email address.' });
      return;
    }
    if (!validPassword(body.password)) {
      response.status(400).json({ success: false, data: null, error: 'Use a password of at least 8 characters.' });
      return;
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    try {
      const session = await auth.register(getUserId(auth, request), { email, password: body.password, ...(displayName ? { displayName } : {}) });
      sendSuccess(response, session, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/auth/login', async (request, response) => {
    const body = asRecord(request.body);
    const email = normalizeEmail(body.email);
    if (!email || typeof body.password !== 'string' || body.password.length === 0 || body.password.length > 200) {
      response.status(400).json({ success: false, data: null, error: 'Enter your email and password.' });
      return;
    }
    try {
      sendSuccess(response, await auth.login(getUserId(auth, request), { email, password: body.password }));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/auth/me', async (request, response) => {
    const userId = getUserId(auth, request);
    if (!userId) {
      sendUnauthorized(response);
      return;
    }
    try {
      const user = await auth.getUser(userId);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      sendSuccess(response, publicProfile(user));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.patch('/me/profile', async (request, response) => {
    const userId = getUserId(auth, request);
    const user = userId ? await auth.getUser(userId).catch(() => null) : null;
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    const raw = asRecord(request.body).displayName;
    const displayName = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
    const rest = { ...user };
    delete rest.displayName;
    try {
      const updated: UserData = { ...rest, ...(displayName ? { displayName } : {}) };
      await auth.update(updated);
      sendSuccess(response, publicProfile(updated));
    } catch (error) {
      sendFailure(response, error);
    }
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
