import type { AuthService } from '../auth/auth.js';
import type { UserData } from '../user/store.js';

export interface McpCaller {
  readonly userId: string;
  readonly user: UserData;
}

/**
 * The bearer token itself is verified once per HTTP request, in `server.ts`, from the
 * `Authorization` header — per the MCP authorization spec, never as a tool argument (that would
 * put the credential in the model's own context/transcript). Once the router has a `userId`, each
 * tool still re-reads it fresh here rather than trusting a snapshot taken earlier in the request,
 * so the MCP server keeps no session state of its own between calls (see
 * `.planning/19-MCP-CONNECTOR-PLAN.md`).
 */
export async function loadCaller(auth: AuthService, userId: string): Promise<McpCaller | null> {
  try {
    const user = await auth.getUser(userId);
    return user ? { userId, user } : null;
  } catch {
    return null;
  }
}
