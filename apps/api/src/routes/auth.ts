import { Router, type Request, type Response } from 'express';

import { bearerToken } from '../auth/auth.js';
import type { AuthService } from '../auth/auth.js';
import type { UserData } from '../user/store.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

/** What the browser may know about an account. */
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

  /**
   * Called once right after Google sign-in, with the new Convex token as the bearer
   * and the browser's old guest token in the body, so everything liked or built
   * before signing in follows the listener into their account.
   */
  router.post('/auth/link', async (request, response) => {
    const accountUserId = await getUserId(auth, request);
    if (!accountUserId) {
      sendUnauthorized(response);
      return;
    }
    const guestToken = asRecord(request.body).guestToken;
    if (typeof guestToken !== 'string' || !guestToken) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const guest = await auth.resolveCaller(guestToken);
      if (guest?.source === 'guest') {
        await auth.linkGuest(guest.userId, accountUserId);
      }
      const user = await auth.getUser(accountUserId);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      sendSuccess(response, publicProfile(user));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/auth/me', async (request, response) => {
    try {
      const userId = await getUserId(auth, request);
      const user = userId ? await auth.getUser(userId) : null;
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
    try {
      const userId = await getUserId(auth, request);
      const user = userId ? await auth.getUser(userId) : null;
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      const raw = asRecord(request.body).displayName;
      const displayName = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
      const rest = { ...user };
      delete rest.displayName;
      const updated: UserData = { ...rest, ...(displayName ? { displayName } : {}) };
      await auth.update(updated);
      sendSuccess(response, publicProfile(updated));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

export async function getUserId(auth: AuthService, request: Request): Promise<string | null> {
  const token = bearerToken(request.header('authorization'));
  if (!token) return null;
  return (await auth.resolveCaller(token))?.userId ?? null;
}

export function sendUnauthorized(response: Response): void {
  response.status(401).json({ success: false, data: null, error: 'Please start a guest session first.' });
}
