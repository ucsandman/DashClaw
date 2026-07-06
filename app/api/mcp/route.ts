export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { DashClawClient } from '../../../mcp-server/lib/client.js';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../../mcp-server/lib/tools.js';
import { RESOURCE_DEFINITIONS, createResourceHandlers } from '../../../mcp-server/lib/resources.js';
// Single source of truth for the MCP server version — never hardcode here.
import mcpServerPkg from '../../../mcp-server/package.json' with { type: 'json' };

const SERVER_INFO = {
  name: '@dashclaw/mcp-server',
  version: mcpServerPkg.version,
};

const PROTOCOL_VERSION = '2025-03-26';

function jsonrpc(id: any, result: any) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id: any, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * Resolve the origin this route calls back into for its own instance's API.
 * This route forwards the caller's credential (Bearer/x-api-key) to that origin,
 * so prefer TRUSTED, non-request-derived sources to avoid SSRF / credential
 * exfiltration via a spoofed Host:
 *   1. DASHCLAW_URL — explicit operator override (self-host).
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel's platform-set PUBLIC production
 *      domain (e.g. my-dashclaw.vercel.app). Vercel documents this as the way to
 *      reliably link to production. NOT VERCEL_URL: that is the per-deployment URL
 *      behind Vercel deployment protection, which answers server-side fetches with
 *      an HTML SSO page (every tool call then fails with "HTML instead of JSON").
 *   3. The request Host — last resort for non-Vercel self-host with no
 *      DASHCLAW_URL. Operators behind a proxy that forwards an arbitrary Host MUST
 *      set DASHCLAW_URL, or a spoofed Host could redirect this self-callback (and
 *      the forwarded credential) elsewhere.
 */
function instanceOrigin(request: Request) {
  if (process.env.DASHCLAW_URL) return process.env.DASHCLAW_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const host = request.headers.get('host');
  if (host) {
    const hostname = host.split(':')[0]; // exact host check (not startsWith: 'localhost.evil.com' must NOT match)
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    // Only trust X-Forwarded-Proto behind an explicitly trusted proxy (mirrors the
    // middleware's TRUST_PROXY convention); otherwise infer from the host.
    const trustProxy = ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
    const proto = (trustProxy && request.headers.get('x-forwarded-proto')) || (isLocal ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

/**
 * Resolve config from request headers.
 * The x-api-key header (or Bearer Authorization) is already validated by middleware.
 *
 * Agent identity: OAuth Bearer callers are the Claude consumer-app custom
 * connector (the only client of the built-in OAuth AS), so they get the
 * documented `claude-desktop` server-level identity — identity is a governance
 * primitive, and without a server-level default the write-identity fallback in
 * createToolHandlers lets the LLM pick its own agent_id per call. x-api-key
 * callers (Managed Agents, remote MCP hosts) keep their existing behavior.
 */
function resolveConfig(request: Request) {
  const apiKey = request.headers.get('x-api-key') || '';
  const authHeader = request.headers.get('authorization') || '';
  // Mirror DashClawClient._authHeaders: a Bearer Authorization is the credential
  // actually forwarded (it wins over x-api-key), so it decides the identity too.
  const isOAuthBearer = authHeader.slice(0, 7).toLowerCase() === 'bearer ';
  return {
    url: instanceOrigin(request),
    apiKey,
    authHeader,
    ...(isOAuthBearer ? { agentId: 'claude-desktop' } : {}),
  };
}

/**
 * POST /api/mcp — Streamable HTTP transport for the MCP protocol.
 * Implements JSON-RPC 2.0 directly (no MCP SDK transport layer).
 * Middleware handles auth; route is stateless per-request.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, method, params } = body;

    const config = resolveConfig(request);
    const client = new DashClawClient(config);
    const toolHandlers = createToolHandlers(client);
    const resourceHandlers = createResourceHandlers(client);

    switch (method) {
      case 'initialize':
        // Echo the client's requested protocol version so newer remote clients
        // (e.g. Claude Desktop sends 2025-11-25) accept the handshake instead of
        // rejecting an older server-declared version. Falls back to ours.
        return jsonrpc(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
        });

      case 'notifications/initialized':
        // JSON-RPC 2.0: notifications carry no id and MUST NOT receive a
        // response body. Returning a jsonrpc result frame here is a
        // protocol violation that strict clients (Cursor, some Desktop
        // builds) flag as an unexpected message. 204 No Content is
        // equivalent to "acknowledged with nothing to say".
        return new Response(null, { status: 204 });

      case 'tools/list':
        return jsonrpc(id, {
          tools: TOOL_DEFINITIONS.map((def: any) => ({
            name: def.name,
            description: def.description,
            inputSchema: def.inputSchema,
          })),
        });

      case 'tools/call': {
        const { name, arguments: args } = params;
        const handler = toolHandlers[name];
        if (!handler) {
          return jsonrpcError(id, -32602, `Unknown tool: ${name}`);
        }
        try {
          const text = await handler(args || {});
          return jsonrpc(id, {
            content: [{ type: 'text', text }],
          });
        } catch (toolErr) {
          console.error('MCP tools/call error:', toolErr);
          return jsonrpc(id, {
            content: [{ type: 'text', text: (toolErr as { message?: string })?.message || 'Tool execution failed' }],
            isError: true,
          });
        }
      }

      case 'resources/list':
        return jsonrpc(id, {
          resources: RESOURCE_DEFINITIONS.filter((d: any) => !d.isTemplate).map((def: any) => ({
            uri: def.uri,
            name: def.name,
            description: def.description,
            mimeType: def.mimeType,
          })),
          resourceTemplates: RESOURCE_DEFINITIONS.filter((d: any) => d.isTemplate).map((def: any) => ({
            uriTemplate: def.uri,
            name: def.name,
            description: def.description,
            mimeType: def.mimeType,
          })),
        });

      case 'resources/read': {
        const { uri } = params;
        // Match static resources
        const staticHandler = resourceHandlers[uri];
        if (staticHandler) {
          const text = await staticHandler();
          return jsonrpc(id, { contents: [{ uri, text }] });
        }
        // Match template: dashclaw://agent/{agent_id}/history
        const historyMatch = uri.match(/^dashclaw:\/\/agent\/([^/]+)\/history$/);
        if (historyMatch) {
          const text = await (resourceHandlers['dashclaw://agent/{agent_id}/history'] as (args: Record<string, unknown>) => Promise<string>)({ agent_id: historyMatch[1] });
          return jsonrpc(id, { contents: [{ uri, text }] });
        }
        return jsonrpcError(id, -32602, `Unknown resource: ${uri}`);
      }

      case 'ping':
        return jsonrpc(id, {});

      default:
        return jsonrpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error('MCP route error:', err);
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      { status: 500 },
    );
  }
}
