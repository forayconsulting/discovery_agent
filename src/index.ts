import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { KVNamespace, Hyperdrive, R2Bucket } from '@cloudflare/workers-types';
import api from './routes/api';
import admin from './routes/admin';

export interface Env {
  SESSION_KV: KVNamespace;
  HYPERDRIVE: Hyperdrive;
  ANTHROPIC_API_KEY: string;
  ADMIN_PASSWORD: string;
  MONDAY_API_KEY?: string;
  DOCUMENTS_R2: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors());

// Root redirect
app.get('/', (c) => c.redirect('/admin.html'));

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount route groups
app.route('/api', api);
app.route('/api/admin', admin);

export default app;
