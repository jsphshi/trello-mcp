import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { Server, Tool, sseMiddleware } from '@modelcontextprotocol/sdk';

const app = express();
app.use(express.json());

const BASE = 'https://api.trello.com/1';
const withAuth = (url) =>
  `${url}${url.includes('?') ? '&' : '?'}key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`;

async function trello(path, init) {
  const r = await fetch(withAuth(`${BASE}${path}`), init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${await r.text()}`);
  return r.json();
}

const mcp = new Server({ name: 'trello-mcp', version: '0.1.0' });

mcp.tool(
  new Tool({
    name: 'trello_list_boards',
    description: 'List boards for the authenticated user',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }),
  async () => {
    const boards = await trello('/members/me/boards');
    return { content: boards.map(b => ({ id: b.id, name: b.name })) };
  }
);

mcp.tool(
  new Tool({
    name: 'trello_list_lists',
    description: 'List lists (columns) on a board',
    inputSchema: {
      type: 'object',
      required: ['boardId'],
      properties: { boardId: { type: 'string' } },
      additionalProperties: false
    }
  }),
  async ({ boardId }) => {
    const lists = await trello(`/boards/${boardId}/lists`);
    return { content: lists.map(l => ({ id: l.id, name: l.name })) };
  }
);

mcp.tool(
  new Tool({
    name: 'trello_create_card',
    description: 'Create a card in a given list',
    inputSchema: {
      type: 'object',
      required: ['listId', 'name'],
      properties: { listId: { type: 'string' }, name: { type: 'string' }, desc: { type: 'string' } },
      additionalProperties: false
    }
  }),
  async ({ listId, name, desc }) => {
    const body = new URLSearchParams({ idList: listId, name, ...(desc ? { desc } : {}) });
    const card = await trello(`/cards?`, { method: 'POST', body });
    return { content: { id: card.id, url: card.shortUrl, name: card.name } };
  }
);

app.get('/sse', sseMiddleware(mcp));
app.get('/', (_req, res) => res.send('trello-mcp OK'));
app.listen(process.env.PORT || 3000, () => console.log('trello-mcp listening'));
