import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { KVNamespace, Hyperdrive } from '@cloudflare/workers-types';
import api from './routes/api';
import admin from './routes/admin';

export interface Env {
  SESSION_KV: KVNamespace;
  HYPERDRIVE: Hyperdrive;
  ANTHROPIC_API_KEY: string;
  ADMIN_PASSWORD: string;
  MONDAY_API_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors());

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount route groups
app.route('/api', api);
app.route('/api/admin', admin);

export default app;
