import { Hono } from 'hono';
import type { Env } from '../index';
import { saveAdminToken, validateAdminToken, getConfigValue, setConfigValue } from '../services/session';
import * as db from '../services/db';
import * as monday from '../services/monday';

const admin = new Hono<{ Bindings: Env }>();

// Admin auth middleware
async function requireAuth(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const valid = await validateAdminToken(c.env.SESSION_KV, token);
  if (!valid) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  await next();
}

// POST /api/admin/login
admin.post('/login', async (c) => {
  const { password } = await c.req.json();

  if (!password || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  // Generate a random auth token
  const token = crypto.randomUUID() + crypto.randomUUID();
  await saveAdminToken(c.env.SESSION_KV, token);

  return c.json({ token });
});

async function getMondayApiKey(c: any): Promise<string | null> {
  const kvKey = await getConfigValue(c.env.SESSION_KV, 'monday_api_key');
  return kvKey || c.env.MONDAY_API_KEY || null;
}

// All routes below require auth
admin.use('/*', async (c, next) => {
  // Skip auth for login
  if (c.req.path.endsWith('/login') && c.req.method === 'POST') {
    return next();
  }
  return requireAuth(c, next);
});

// GET /api/admin/engagements
admin.get('/engagements', async (c) => {
  const engagements = await db.listEngagements(c.env.HYPERDRIVE);
  return c.json({ engagements });
});

// POST /api/admin/engagements
admin.post('/engagements', async (c) => {
  const body = await c.req.json();
  const { name, description, context, mondayItemId, mondayBoardId } = body;

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const engagement = await db.createEngagement(c.env.HYPERDRIVE, {
    name,
    description,
    context,
    mondayItemId,
    mondayBoardId,
  });

  return c.json({ engagement }, 201);
});

// GET /api/admin/engagements/:id
admin.get('/engagements/:id', async (c) => {
  const id = c.req.param('id');
  const engagement = await db.getEngagement(c.env.HYPERDRIVE, id);

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  return c.json({ engagement });
});

// POST /api/admin/engagements/:id/sessions
admin.post('/engagements/:id/sessions', async (c) => {
  const engagementId = c.req.param('id');
  const body = await c.req.json();
  const { stakeholderName, stakeholderEmail, stakeholderRole } = body;

  if (!stakeholderName) {
    return c.json({ error: 'Stakeholder name is required' }, 400);
  }

  // Verify engagement exists
  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  // Generate a 64-char hex token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const session = await db.createSession(c.env.HYPERDRIVE, {
    engagementId,
    token,
    stakeholderName,
    stakeholderEmail,
    stakeholderRole,
  });

  // Build the shareable link
  const url = new URL(c.req.url);
  const shareableLink = `${url.origin}/session.html?token=${token}`;

  return c.json({ session, shareableLink }, 201);
});

// POST /api/admin/engagements/:id/sessions/batch — Create multiple sessions at once
admin.post('/engagements/:id/sessions/batch', async (c) => {
  const engagementId = c.req.param('id');
  const { stakeholders } = await c.req.json();

  if (!Array.isArray(stakeholders) || stakeholders.length === 0) {
    return c.json({ error: 'At least one stakeholder is required' }, 400);
  }

  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  const url = new URL(c.req.url);
  const results = [];

  for (const sh of stakeholders) {
    if (!sh.name?.trim()) continue;

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes)
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('');

    const session = await db.createSession(c.env.HYPERDRIVE, {
      engagementId,
      token,
      stakeholderName: sh.name.trim(),
      stakeholderEmail: sh.email?.trim() || undefined,
      stakeholderRole: sh.role?.trim() || undefined,
    });

    results.push({
      session,
      shareableLink: `${url.origin}/session.html?token=${token}`,
    });
  }

  return c.json({ sessions: results }, 201);
});

// Monday.com integration routes

// GET /api/admin/monday/search?term=...
admin.get('/monday/search', async (c) => {
  const mondayKey = await getMondayApiKey(c);
  if (!mondayKey) {
    return c.json({ error: 'Monday.com API key not configured' }, 400);
  }

  const term = c.req.query('term');
  const boards = await monday.searchBoards(mondayKey, term);
  return c.json({ boards });
});

// GET /api/admin/monday/boards/:boardId/items
admin.get('/monday/boards/:boardId/items', async (c) => {
  const mondayKey = await getMondayApiKey(c);
  if (!mondayKey) {
    return c.json({ error: 'Monday.com API key not configured' }, 400);
  }

  const boardId = c.req.param('boardId');
  const items = await monday.getBoardItems(mondayKey, boardId);
  return c.json({ items });
});

// GET /api/admin/monday/item/:id
admin.get('/monday/item/:id', async (c) => {
  const mondayKey = await getMondayApiKey(c);
  if (!mondayKey) {
    return c.json({ error: 'Monday.com API key not configured' }, 400);
  }

  const itemId = c.req.param('id');
  const item = await monday.getItemDetails(mondayKey, itemId);

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const context = monday.extractContextFromItem(item);
  return c.json({ item, context });
});

// GET /api/admin/settings/monday — check if key is configured
admin.get('/settings/monday', async (c) => {
  const kvKey = await getConfigValue(c.env.SESSION_KV, 'monday_api_key');
  const envKey = c.env.MONDAY_API_KEY;
  return c.json({
    configured: !!(kvKey || envKey),
    source: kvKey ? 'admin' : envKey ? 'env' : 'none',
  });
});

// POST /api/admin/settings/monday — save key to KV
admin.post('/settings/monday', async (c) => {
  const { apiKey } = await c.req.json();
  if (!apiKey || typeof apiKey !== 'string') {
    return c.json({ error: 'API key is required' }, 400);
  }
  await setConfigValue(c.env.SESSION_KV, 'monday_api_key', apiKey.trim());
  return c.json({ success: true });
});

export default admin;
