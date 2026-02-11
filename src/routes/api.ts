import { Hono } from 'hono';
import type { Env } from '../index';
import * as db from '../services/db';
import * as sessionService from '../services/session';
import * as claude from '../services/claude';
import type { QuizAnswer, ConversationState } from '../schemas/quiz';

const api = new Hono<{ Bindings: Env }>();

// GET /api/session/:token - Validate token, return session metadata
api.get('/session/:token', async (c) => {
  const token = c.req.param('token');
  const session = await db.getSessionByToken(c.env.HYPERDRIVE, token);

  if (!session) {
    return c.json({ error: 'Invalid session token' }, 404);
  }

  return c.json({
    session: {
      id: session.id,
      stakeholderName: session.stakeholder_name,
      stakeholderRole: session.stakeholder_role,
      status: session.status,
      engagementName: session.engagement_name,
      engagementDescription: session.engagement_description,
    },
  });
});

// POST /api/session/:token/start - Init conversation, return first batch
api.post('/session/:token/start', async (c) => {
  const token = c.req.param('token');
  const session = await db.getSessionByToken(c.env.HYPERDRIVE, token);

  if (!session) {
    return c.json({ error: 'Invalid session token' }, 404);
  }

  if (session.status === 'completed') {
    return c.json({ error: 'This session has already been completed' }, 400);
  }

  // Check for existing state: KV (fast cache) first, then DB (durable)
  let existingState = await sessionService.getConversationState(c.env.SESSION_KV, session.id);
  if (!existingState) {
    existingState = await db.getConversationStateFromDB(c.env.HYPERDRIVE, session.id);
  }

  if (existingState) {
    // Resume: generate next batch from existing state
    const batch = await claude.generateNextBatch(c.env.ANTHROPIC_API_KEY, existingState);

    // If batch has no questions and isn't complete, state is stale — clear and start fresh
    if (batch.questions.length === 0 && !batch.isComplete) {
      await sessionService.deleteConversationState(c.env.SESSION_KV, session.id);
      // Fall through to fresh start below
    } else {
      await sessionService.saveConversationState(c.env.SESSION_KV, existingState);
      await db.saveConversationStateToDB(c.env.HYPERDRIVE, session.id, existingState);
      return c.json({ batch });
    }
  }

  // Initialize new conversation state
  const state: ConversationState = {
    sessionId: session.id,
    engagementContext: session.engagement_context || '',
    stakeholderName: session.stakeholder_name,
    stakeholderRole: session.stakeholder_role,
    messages: [],
    allAnswers: [],
    currentBatchNumber: 1,
  };

  // Generate first batch
  const batch = await claude.generateNextBatch(c.env.ANTHROPIC_API_KEY, state);

  // Update session status to in_progress
  await db.updateSessionStatus(c.env.HYPERDRIVE, session.id, 'in_progress');

  // Save state to KV (cache) and DB (durable)
  await sessionService.saveConversationState(c.env.SESSION_KV, state);
  await db.saveConversationStateToDB(c.env.HYPERDRIVE, session.id, state);

  return c.json({ batch });
});

// POST /api/session/:token/answer - Submit answers, get next batch
api.post('/session/:token/answer', async (c) => {
  const token = c.req.param('token');
  const session = await db.getSessionByToken(c.env.HYPERDRIVE, token);

  if (!session) {
    return c.json({ error: 'Invalid session token' }, 404);
  }

  if (session.status === 'completed') {
    return c.json({ error: 'This session has already been completed' }, 400);
  }

  const { answers } = (await c.req.json()) as { answers: QuizAnswer[] };

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return c.json({ error: 'Answers are required' }, 400);
  }

  // Get conversation state: KV (cache) first, then DB (durable)
  let state = await sessionService.getConversationState(c.env.SESSION_KV, session.id);
  if (!state) {
    state = await db.getConversationStateFromDB(c.env.HYPERDRIVE, session.id);
  }
  if (!state) {
    return c.json({ error: 'Session state not found. Please restart the session.' }, 400);
  }

  // Append answers to state
  claude.appendAnswersToState(state, answers);

  // Generate next batch
  const batch = await claude.generateNextBatch(c.env.ANTHROPIC_API_KEY, state);

  // Save updated state to KV (cache) and DB (durable)
  await sessionService.saveConversationState(c.env.SESSION_KV, state);
  await db.saveConversationStateToDB(c.env.HYPERDRIVE, session.id, state);

  return c.json({ batch });
});

// POST /api/session/:token/submit - Finalize session
api.post('/session/:token/submit', async (c) => {
  const token = c.req.param('token');
  const session = await db.getSessionByToken(c.env.HYPERDRIVE, token);

  if (!session) {
    return c.json({ error: 'Invalid session token' }, 404);
  }

  if (session.status === 'completed') {
    return c.json({ error: 'This session has already been completed' }, 400);
  }

  // Get conversation state: KV (cache) first, then DB (durable)
  let state = await sessionService.getConversationState(c.env.SESSION_KV, session.id);
  if (!state) {
    state = await db.getConversationStateFromDB(c.env.HYPERDRIVE, session.id);
  }
  if (!state) {
    return c.json({ error: 'Session state not found' }, 400);
  }

  // If there are final answers in the request body, append them
  try {
    const body = await c.req.json();
    if (body.answers && Array.isArray(body.answers) && body.answers.length > 0) {
      claude.appendAnswersToState(state, body.answers);
    }
  } catch {
    // No body or invalid JSON is fine for submit
  }

  // Generate summary
  const summaryResult = await claude.generateSummary(c.env.ANTHROPIC_API_KEY, state);

  // Save results to PostgreSQL
  await db.saveDiscoveryResults(c.env.HYPERDRIVE, {
    sessionId: session.id,
    rawConversation: state.messages,
    answersStructured: state.allAnswers,
    aiSummary: summaryResult.summary,
  });

  // Update session status
  await db.updateSessionStatus(c.env.HYPERDRIVE, session.id, 'completed');

  // Clean up KV and DB state
  await sessionService.deleteConversationState(c.env.SESSION_KV, session.id);
  await db.saveConversationStateToDB(c.env.HYPERDRIVE, session.id, null);

  return c.json({
    summary: summaryResult.summary,
    keyThemes: summaryResult.keyThemes,
    priorityLevel: summaryResult.priorityLevel,
  });
});

export default api;
