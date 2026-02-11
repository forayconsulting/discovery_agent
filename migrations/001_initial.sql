CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE engagements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    context TEXT,
    monday_item_id TEXT,
    monday_board_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id UUID NOT NULL REFERENCES engagements(id),
    token VARCHAR(64) UNIQUE NOT NULL,
    stakeholder_name TEXT NOT NULL,
    stakeholder_email TEXT,
    stakeholder_role TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE discovery_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID UNIQUE NOT NULL REFERENCES sessions(id),
    raw_conversation JSONB NOT NULL,
    answers_structured JSONB NOT NULL,
    ai_summary TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_engagement ON sessions(engagement_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_results_session ON discovery_results(session_id);
