import type { KVNamespace } from '@cloudflare/workers-types';
import type { ConversationState } from '../schemas/quiz';

const SESSION_TTL = 7200; // 2 hours

function kvKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function getConversationState(
  kv: KVNamespace,
  sessionId: string
): Promise<ConversationState | null> {
  const data = await kv.get(kvKey(sessionId), 'json');
  return data as ConversationState | null;
}

export async function saveConversationState(
  kv: KVNamespace,
  state: ConversationState
): Promise<void> {
  await kv.put(kvKey(state.sessionId), JSON.stringify(state), {
    expirationTtl: SESSION_TTL,
  });
}

export async function deleteConversationState(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(kvKey(sessionId));
}

// Admin auth token management

function adminTokenKey(token: string): string {
  return `admin:${token}`;
}

const ADMIN_TOKEN_TTL = 86400; // 24 hours

export async function saveAdminToken(
  kv: KVNamespace,
  token: string
): Promise<void> {
  await kv.put(adminTokenKey(token), '1', {
    expirationTtl: ADMIN_TOKEN_TTL,
  });
}

export async function validateAdminToken(
  kv: KVNamespace,
  token: string
): Promise<boolean> {
  const val = await kv.get(adminTokenKey(token));
  return val !== null;
}

// KV-based config management
export async function getConfigValue(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(`config:${key}`);
}

export async function setConfigValue(kv: KVNamespace, key: string, value: string): Promise<void> {
  await kv.put(`config:${key}`, value);
}
