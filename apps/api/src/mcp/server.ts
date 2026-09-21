import { Router, type Request, type Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { bearerToken } from '../auth/auth.js';
import type { AppServices } from '../services.js';
import { registerTools } from './tools.js';

const WWW_AUTHENTICATE = 'Bearer realm="allegra-mcp"';

function unauthorized(response: Response): void {
  // Per the MCP authorization spec: invalid/missing tokens get 401 with WWW-Authenticate, not a
  // 200 wrapping a tool-level error — this has to be rejected before any JSON-RPC is parsed.
  response.setHeader('WWW-Authenticate', WWW_AUTHENTICATE);
  response.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid bearer token. Send Authorization: Bearer <allegra-token>.' }, id: null });
}

/**
 * Mounts a stateless MCP endpoint at `POST /mcp`. Stateless by construction: a fresh McpServer
 * and transport are built for every request and torn down when it closes, so nothing about a
 * caller survives between calls — every tool re-reads the user fresh from Convex on its own
 * (see `.planning/19-MCP-CONNECTOR-PLAN.md` and `docs/mcp-contract.md`).
 *
 * Auth is the bearer token in the `Authorization` header — verified once per HTTP request, here,
 * never taken from a tool argument (the MCP spec requires the header; a tool argument would also
 * put the credential in the model's own context/transcript, a materially worse exposure).
 */
export function mcpRouter(services: AppServices): Router {
  const router = Router();

  router.post('/mcp', async (request, response) => {
    const token = bearerToken(request.header('authorization'));
    const verified = token ? await services.auth.resolveCaller(token) : null;
    if (!verified) {
      unauthorized(response);
      return;
    }

    const server = new McpServer({ name: 'allegra', version: '1.0.0' });
    registerTools(server, services, verified.userId);
    try {
      // Omitting sessionIdGenerator (rather than setting it to `undefined`) is what puts the
      // transport in stateless mode; the SDK's own optional-callback types collide with this
      // project's `exactOptionalPropertyTypes`, hence the cast on connect().
      const transport = new StreamableHTTPServerTransport({});
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!response.headersSent) {
        response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const methodNotAllowed = (_request: Request, response: Response): void => {
    response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This is a stateless MCP endpoint — POST only.' }, id: null });
  };
  router.get('/mcp', methodNotAllowed);
  router.delete('/mcp', methodNotAllowed);

  return router;
}
