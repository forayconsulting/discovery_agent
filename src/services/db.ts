import { Client } from 'pg';
import type { Hyperdrive } from '@cloudflare/workers-types';

function getClient(hyperdrive: Hyperdrive): Client {
  return new Client({
    connectionString: hyperdrive.connectionString,
  });
}

// Engagement operations

export async function createEngagement(
  hyperdrive: Hyperdrive,
  data: {
    name: string;
    description?: string;
    context?: string;
    mondayItemId?: string;
    mondayBoardId?: string;
  }
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO engagements (name, description, context, monday_item_id, monday_board_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.name, data.description || null, data.context || null, data.mondayItemId || null, data.mondayBoardId || null]
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function listEngagements(hyperdrive: Hyperdrive) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT e.*,
        COUNT(s.id) AS session_count,
        COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_count
       FROM engagements e
       LEFT JOIN sessions s ON s.engagement_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function getEngagement(hyperdrive: Hyperdrive, id: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const engagement = await client.query('SELECT * FROM engagements WHERE id = $1', [id]);
    if (engagement.rows.length === 0) return null;

    const sessions = await client.query(
      'SELECT * FROM sessions WHERE engagement_id = $1 ORDER BY created_at DESC',
      [id]
    );

    const completedSessionIds = sessions.rows
      .filter((s: any) => s.status === 'completed')
      .map((s: any) => s.id);

    let results: any[] = [];
    if (completedSessionIds.length > 0) {
      const res = await client.query(
        'SELECT * FROM discovery_results WHERE session_id = ANY($1)',
        [completedSessionIds]
      );
      results = res.rows;
    }

    return {
      ...engagement.rows[0],
      sessions: sessions.rows,
      results,
    };
  } finally {
    await client.end();
  }
}

// Session operations

export async function createSession(
  hyperdrive: Hyperdrive,
  data: {
    engagementId: string;
    token: string;
    stakeholderName: string;
    stakeholderEmail?: string;
    stakeholderRole?: string;
    steeringPrompt?: string;
  }
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO sessions (engagement_id, token, stakeholder_name, stakeholder_email, stakeholder_role, steering_prompt)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.engagementId, data.token, data.stakeholderName, data.stakeholderEmail || null, data.stakeholderRole || null, data.steeringPrompt || null]
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function getSessionByToken(hyperdrive: Hyperdrive, token: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT s.*, e.name AS engagement_name, e.description AS engagement_description, e.context AS engagement_context
       FROM sessions s
       JOIN engagements e ON e.id = s.engagement_id
       WHERE s.token = $1`,
      [token]
    );
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

export async function updateSessionStatus(
  hyperdrive: Hyperdrive,
  sessionId: string,
  status: string
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
    await client.query(
      `UPDATE sessions SET status = $1, completed_at = ${completedAt} WHERE id = $2`,
      [status, sessionId]
    );
  } finally {
    await client.end();
  }
}

export async function saveConversationStateToDB(
  hyperdrive: Hyperdrive,
  sessionId: string,
  state: any
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE sessions SET conversation_state = $1 WHERE id = $2',
      [JSON.stringify(state), sessionId]
    );
  } finally {
    await client.end();
  }
}

export async function getConversationStateFromDB(
  hyperdrive: Hyperdrive,
  sessionId: string
): Promise<any | null> {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      'SELECT conversation_state FROM sessions WHERE id = $1',
      [sessionId]
    );
    return result.rows[0]?.conversation_state || null;
  } finally {
    await client.end();
  }
}

export async function saveAnswersAndComplete(
  hyperdrive: Hyperdrive,
  data: {
    sessionId: string;
    rawConversation: any;
    answersStructured: any;
  }
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      `INSERT INTO discovery_results (session_id, raw_conversation, answers_structured, ai_summary)
       VALUES ($1, $2, $3, '')
       ON CONFLICT (session_id) DO UPDATE SET
         raw_conversation = EXCLUDED.raw_conversation,
         answers_structured = EXCLUDED.answers_structured`,
      [data.sessionId, JSON.stringify(data.rawConversation), JSON.stringify(data.answersStructured)]
    );
    await client.query(
      `UPDATE sessions SET status = 'completed', completed_at = NOW(), conversation_state = NULL WHERE id = $1`,
      [data.sessionId]
    );
  } finally {
    await client.end();
  }
}

export async function updateDiscoverySummary(
  hyperdrive: Hyperdrive,
  sessionId: string,
  aiSummary: string
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE discovery_results SET ai_summary = $1 WHERE session_id = $2',
      [aiSummary, sessionId]
    );
  } finally {
    await client.end();
  }
}

export async function getDiscoveryResult(hyperdrive: Hyperdrive, sessionId: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      'SELECT * FROM discovery_results WHERE session_id = $1',
      [sessionId]
    );
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

export async function getSessionById(hyperdrive: Hyperdrive, sessionId: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT s.*, e.name AS engagement_name, e.context AS engagement_context
       FROM sessions s
       JOIN engagements e ON e.id = s.engagement_id
       WHERE s.id = $1`,
      [sessionId]
    );
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
}

export async function getAllSummariesForEngagement(hyperdrive: Hyperdrive, engagementId: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `SELECT s.stakeholder_name, s.stakeholder_role, dr.ai_summary
       FROM sessions s
       JOIN discovery_results dr ON dr.session_id = s.id
       WHERE s.engagement_id = $1 AND dr.ai_summary IS NOT NULL AND dr.ai_summary != ''`,
      [engagementId]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function updateEngagementOverview(hyperdrive: Hyperdrive, engagementId: string, overview: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE engagements SET engagement_overview = $1 WHERE id = $2',
      [overview, engagementId]
    );
  } finally {
    await client.end();
  }
}

// Document operations

export async function createEngagementDocument(
  hyperdrive: Hyperdrive,
  data: {
    engagementId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    r2Key: string;
  }
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO engagement_documents (engagement_id, filename, content_type, size_bytes, r2_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.engagementId, data.filename, data.contentType, data.sizeBytes, data.r2Key]
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function getEngagementDocuments(hyperdrive: Hyperdrive, engagementId: string) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    const result = await client.query(
      'SELECT * FROM engagement_documents WHERE engagement_id = $1 ORDER BY created_at DESC',
      [engagementId]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function updateDocumentStatus(
  hyperdrive: Hyperdrive,
  documentId: string,
  status: string,
  errorMessage?: string
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE engagement_documents SET processing_status = $1, error_message = $2 WHERE id = $3',
      [status, errorMessage || null, documentId]
    );
  } finally {
    await client.end();
  }
}

export async function updateAllDocumentStatuses(
  hyperdrive: Hyperdrive,
  engagementId: string,
  status: string,
  errorMessage?: string
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE engagement_documents SET processing_status = $1, error_message = $2 WHERE engagement_id = $3',
      [status, errorMessage || null, engagementId]
    );
  } finally {
    await client.end();
  }
}

export async function updateEngagementFromDocuments(
  hyperdrive: Hyperdrive,
  engagementId: string,
  description: string,
  context: string
) {
  const client = getClient(hyperdrive);
  await client.connect();
  try {
    await client.query(
      'UPDATE engagements SET description = $1, context = $2 WHERE id = $3',
      [description, context, engagementId]
    );
  } finally {
    await client.end();
  }
}
