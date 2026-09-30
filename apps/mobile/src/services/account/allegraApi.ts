/**
 * Calls to Allegra's API (apps/api) with the account's Convex token. Every call
 * uses fetchWithTimeout: a timeout, and null on any failure, never a throw.
 * Shapes follow docs/api-contract.md: `{ success, data, error? }`.
 */
import { fetchJson } from '../net/fetchWithTimeout';
import { ALLEGRA_API_URL } from './config';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** `GET /api/auth/me` (docs/api-contract.md, Accounts). */
export interface AccountProfile {
  userId: string;
  isGuest: boolean;
  createdAt: string;
  displayName?: string;
  email?: string;
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Who this signed-in listener is, or null (signed out, offline, or a guest token). */
export const getAccountProfile = async (token: string): Promise<AccountProfile | null> => {
  const res = await fetchJson<Envelope<AccountProfile>>(`${ALLEGRA_API_URL}/api/auth/me`, {
    headers: authHeaders(token),
    timeoutMs: 10_000,
  });
  return res?.success && res.data && !res.data.isGuest ? res.data : null;
};
