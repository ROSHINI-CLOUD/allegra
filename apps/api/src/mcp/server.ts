import { Router, type Request, type Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { publicOrigin, resourceMetadataUrl, verifyMcpAccess } from '../oauth/router.js';
import type { OAuthSigner } from '../oauth/tokens.js';
import type { AppServices } from '../services.js';
import { registerTools } from './tools.js';

function unauthorized(request: Request, response: Response, hadToken: boolean): void {
  // Per the MCP authorization spec: 401 with a WWW-Authenticate that points at the protected
  // resource metadata, which is how a client (ChatGPT, Claude…) discovers where to sign in.
  const metadata = resourceMetadataUrl(publicOrigin(request));
  const invalid = hadToken ? ', error="invalid_token"' : '';
  response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="music"${invalid}`);
  response.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required. Connect Allegra from your assistant to sign in.' }, id: null });
}

/**
 * Mounts a stateless MCP endpoint at `POST /mcp`. Stateless by construction: a fresh McpServer
 * and transport are built for every request and torn down when it closes, so nothing about a
 * caller survives between calls — every tool re-reads the user fresh from Convex on its own
 * (see `.planning/19-MCP-CONNECTOR-PLAN.md` and `docs/mcp-contract.md`).
 *
 * Auth is an OAuth access token this API issued for exactly this endpoint (see oauth/router.ts),
 * in the `Authorization` header — verified once per HTTP request, here, never taken from a tool
 * argument. App session tokens and tokens for any other resource are refused (no passthrough).
 */
export function mcpRouter(services: AppServices, signer: OAuthSigner): Router {
  const router = Router();

  router.post('/mcp', async (request, response) => {
    const verified = verifyMcpAccess(signer, request);
    if (!verified) {
      unauthorized(request, response, Boolean(request.header('authorization')));
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
