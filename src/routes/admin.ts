import { Hono } from 'hono';
import type { Env } from '../index';
import { saveAdminToken, validateAdminToken, getConfigValue, setConfigValue } from '../services/session';
import * as db from '../services/db';
import * as monday from '../services/monday';
import * as claude from '../services/claude';

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
  const { stakeholderName, stakeholderEmail, stakeholderRole, steeringPrompt } = body;

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
    steeringPrompt,
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
      steeringPrompt: sh.steeringPrompt?.trim() || undefined,
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

// POST /api/admin/engagements/:id/suggest-steering
admin.post('/engagements/:id/suggest-steering', async (c) => {
  const engagementId = c.req.param('id');
  const { stakeholderName, stakeholderRole } = await c.req.json();

  if (!stakeholderName) {
    return c.json({ error: 'Stakeholder name is required' }, 400);
  }

  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  try {
    const suggestions = await claude.generateSteeringSuggestions(
      c.env.ANTHROPIC_API_KEY,
      engagement.context || '',
      stakeholderName,
      stakeholderRole
    );
    return c.json({ suggestions });
  } catch (err) {
    return c.json({ suggestions: [] });
  }
});

// POST /api/admin/engagements/:id/refresh-overview
admin.post('/engagements/:id/refresh-overview', async (c) => {
  const engagementId = c.req.param('id');

  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  const allSummaries = await db.getAllSummariesForEngagement(c.env.HYPERDRIVE, engagementId);
  if (allSummaries.length < 2) {
    return c.json({ error: 'Need at least 2 completed summaries to generate an overview' }, 400);
  }

  // Fire-and-forget: generate overview in the background to avoid request timeout
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const overview = await claude.generateEngagementOverview(
          c.env.ANTHROPIC_API_KEY,
          engagement.context || '',
          allSummaries.map((s: any) => ({
            stakeholderName: s.stakeholder_name,
            stakeholderRole: s.stakeholder_role,
            summary: s.ai_summary,
          }))
        );
        await db.updateEngagementOverview(c.env.HYPERDRIVE, engagementId, overview);
      } catch (err) {
        console.error('Failed to generate engagement overview:', err);
      }
    })()
  );

  return c.json({ generating: true });
});

// POST /api/admin/sessions/:sessionId/retry-summary
admin.post('/sessions/:sessionId/retry-summary', async (c) => {
  const sessionId = c.req.param('sessionId');

  const session = await db.getSessionById(c.env.HYPERDRIVE, sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const result = await db.getDiscoveryResult(c.env.HYPERDRIVE, sessionId);
  if (!result) {
    return c.json({ error: 'No discovery results found for this session' }, 404);
  }

  // Reconstruct minimal state from stored data
  const state = {
    sessionId,
    engagementContext: session.engagement_context || '',
    stakeholderName: session.stakeholder_name,
    stakeholderRole: session.stakeholder_role,
    messages: [],
    allAnswers: result.answers_structured || [],
    currentBatchNumber: 0,
  };

  const summaryResult = await claude.generateSummary(c.env.ANTHROPIC_API_KEY, state as any);
  await db.updateDiscoverySummary(c.env.HYPERDRIVE, sessionId, summaryResult.summary);

  return c.json({ summary: summaryResult.summary });
});

// POST /api/admin/engagements/:id/documents — upload documents
admin.post('/engagements/:id/documents', async (c) => {
  const engagementId = c.req.param('id');

  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  const formData = await c.req.formData();
  // Workers types declare getAll as string[], but multipart uploads return File objects at runtime
  const files = formData.getAll('files') as unknown as (File | string)[];

  if (!files || files.length === 0) {
    return c.json({ error: 'No files uploaded' }, 400);
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  const textExtensions = ['.md', '.txt', '.text', '.vtt', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.html', '.htm', '.rtf'];
  const documents = [];

  for (const file of files) {
    if (typeof file === 'string') continue;

    // Validate type
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const isAllowed = file.type === 'application/pdf' || file.type.startsWith('text/') || textExtensions.includes(ext);
    if (!isAllowed) {
      return c.json({ error: `Unsupported file type: ${file.name}. Please upload PDF or text-based files.` }, 400);
    }

    // Validate size
    if (file.size > maxSize) {
      return c.json({ error: `File too large (max 10MB): ${file.name}` }, 400);
    }

    // Upload to R2
    const r2Key = `engagements/${engagementId}/${crypto.randomUUID()}_${file.name}`;
    const arrayBuffer = await file.arrayBuffer();
    await c.env.DOCUMENTS_R2.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    // Save metadata to DB
    const doc = await db.createEngagementDocument(c.env.HYPERDRIVE, {
      engagementId,
      filename: file.name,
      contentType: file.type || 'text/plain',
      sizeBytes: file.size,
      r2Key,
    });

    documents.push(doc);
  }

  return c.json({ documents }, 201);
});

// POST /api/admin/engagements/:id/documents/extract — trigger AI extraction
admin.post('/engagements/:id/documents/extract', async (c) => {
  const engagementId = c.req.param('id');

  const engagement = await db.getEngagement(c.env.HYPERDRIVE, engagementId);
  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404);
  }

  const documents = await db.getEngagementDocuments(c.env.HYPERDRIVE, engagementId);
  if (documents.length === 0) {
    return c.json({ error: 'No documents found for this engagement' }, 400);
  }

  // Guard against concurrent extraction
  const processing = documents.some((d: any) => d.processing_status === 'processing');
  if (processing) {
    return c.json({ error: 'Extraction already in progress' }, 409);
  }

  // Fire-and-forget
  c.executionCtx.waitUntil(
    (async () => {
      try {
        // Mark all docs as processing
        await db.updateAllDocumentStatuses(c.env.HYPERDRIVE, engagementId, 'processing');

        // Fetch file data from R2
        const docData: Array<{ filename: string; contentType: string; data: ArrayBuffer }> = [];
        for (const doc of documents) {
          const obj = await c.env.DOCUMENTS_R2.get(doc.r2_key);
          if (obj) {
            docData.push({
              filename: doc.filename,
              contentType: doc.content_type,
              data: await obj.arrayBuffer(),
            });
          }
        }

        // Call Claude for extraction
        const result = await claude.extractContextFromDocuments(c.env.ANTHROPIC_API_KEY, docData);

        // Update engagement and mark all docs as completed
        await db.updateEngagementFromDocuments(c.env.HYPERDRIVE, engagementId, result.description, result.context);
        await db.updateAllDocumentStatuses(c.env.HYPERDRIVE, engagementId, 'completed');
      } catch (err) {
        console.error('Document extraction failed:', err);
        await db.updateAllDocumentStatuses(c.env.HYPERDRIVE, engagementId, 'failed', (err as Error).message).catch(() => {});
      }
    })()
  );

  return c.json({ extracting: true });
});

// GET /api/admin/engagements/:id/documents — list documents
admin.get('/engagements/:id/documents', async (c) => {
  const engagementId = c.req.param('id');
  const documents = await db.getEngagementDocuments(c.env.HYPERDRIVE, engagementId);
  return c.json({ documents });
});

export default admin;
