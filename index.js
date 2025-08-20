import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

// --- Trello helpers ---
const BASE = 'https://api.trello.com/1';
const withAuth = (url) =>
  `${url}${url.includes('?') ? '&' : '?'}key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`;

async function trello(path, init) {
  const r = await fetch(withAuth(`${BASE}${path}`), init);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${r.statusText}: ${text}`);
  }
  return r.json();
}

// --- Create MCP server ---
const server = new McpServer({
  name: 'trello-mcp',
  version: '0.1.0',
});

// Tools (use zod schemas)
server.registerTool(
  'trello_list_boards',
  {
    title: 'List Trello boards',
    description: 'List boards for the authenticated user',
    inputSchema: z.object({}), // no inputs
  },
  async () => {
    const boards = await trello('/members/me/boards');
    return {
      content: [
        {
          type: 'json',
          json: boards.map((b) => ({ id: b.id, name: b.name })),
        },
      ],
    };
  }
);

server.registerTool(
  'trello_list_lists',
  {
    title: 'List lists on a board',
    description: 'Given a boardId, list its lists (columns)',
    inputSchema: z.object({
      boardId: z.string(),
    }),
  },
  async ({ boardId }) => {
    const lists = await trello(`/boards/${boardId}/lists`);
    return {
      content: [
        {
          type: 'json',
          json: lists.map((l) => ({ id: l.id, name: l.name })),
        },
      ],
    };
  }
);

server.registerTool(
  'trello_create_card',
  {
    title: 'Create a Trello card',
    description: 'Create a card in a given list',
    inputSchema: z.object({
      listId: z.string(),
      name: z.string(),
      desc: z.string().optional(),
    }),
  },
  async ({ listId, name, desc }) => {
    const body = new URLSearchParams({ idList: listId, name, ...(desc ? { desc } : {}) });
    const card = await trello(`/cards?`, { method: 'POST', body });
    return {
      content: [
        {
          type: 'json',
          json: { id: card.id, url: card.shortUrl, name: card.name },
        },
      ],
    };
  }
);

// --- HTTP server with both transports (modern & legacy) ---
const app = express();
app.use(express.json());

// Keep state for Streamable HTTP sessions
const streamableTransports = Object.create(null);

// Modern Streamable HTTP endpoint (preferred by latest clients)
app.all('/mcp', async (req, res) => {
  // Create or resume a session
  const sessionId = req.headers['mcp-session-id'];
  let transport = sessionId ? streamableTransports[sessionId] : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport(req, res);
    streamableTransports[transport.sessionId] = transport;
    transport.onclose = () => {
      delete streamableTransports[transport.sessionId];
    };
    await server.connect(transport);
  } else {
    await transport.handleRequest(req, res);
  }
});

// Legacy SSE endpoint (for older clients / compatibility)
const sseTransports = Object.create(null);

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  sseTransports[transport.sessionId] = transport;
  res.on('close', () => {
    delete sseTransports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`trello-mcp listening on ${PORT}`);
});
