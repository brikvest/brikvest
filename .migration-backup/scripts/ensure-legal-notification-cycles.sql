-- Additive, idempotent cycle identities for explicit legal-document email resends.
-- Existing append-only audit events remain unchanged and are mapped to cycle 1.
BEGIN;

CREATE TABLE IF NOT EXISTS legal_notification_cycles (
  id serial PRIMARY KEY,
  pair_id integer NOT NULL
    REFERENCES legal_document_pairs(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  request_kind text NOT NULL CHECK (request_kind IN ('initial', 'admin_resend')),
  requested_by_admin_id integer
    REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'uncertain', 'exhausted')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT legal_notification_cycles_pair_number_uq UNIQUE (pair_id, cycle_number),
  CONSTRAINT legal_notification_cycles_pair_id_uq UNIQUE (pair_id, id),
  CONSTRAINT legal_notification_cycle_requester_consistent CHECK (
    (request_kind = 'initial' AND requested_by_admin_id IS NULL)
    OR (request_kind = 'admin_resend' AND requested_by_admin_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS legal_notification_cycles_pair_idx
  ON legal_notification_cycles(pair_id, cycle_number DESC);

ALTER TABLE legal_jobs
  ADD COLUMN IF NOT EXISTS notification_cycle_id integer
  REFERENCES legal_notification_cycles(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'legal_jobs_notification_cycle_pair_fk'
  ) THEN
    ALTER TABLE legal_jobs
      ADD CONSTRAINT legal_jobs_notification_cycle_pair_fk
      FOREIGN KEY (pair_id, notification_cycle_id)
      REFERENCES legal_notification_cycles(pair_id, id)
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END;
$$;

-- Give every pre-existing notification job a stable initial generation. The
-- old audit rows are deliberately not rewritten; application queries recognize
-- their cycle-1 jobId/attempt details while all new events include cycleId.
INSERT INTO legal_notification_cycles (
  pair_id, cycle_number, request_kind, requested_by_admin_id, status,
  attempt_count, created_at, updated_at, sent_at
)
SELECT
  j.pair_id,
  1,
  'initial',
  NULL,
  CASE
    WHEN COALESCE(h.has_sent, false) THEN 'sent'
    WHEN COALESCE(h.has_uncertain, false) OR COALESCE(h.has_unresolved, false) THEN 'uncertain'
    WHEN COALESCE(h.has_exhausted, false) OR j.status = 'dead' THEN 'exhausted'
    ELSE 'queued'
  END,
  COALESCE(h.attempt_count, 0),
  j.created_at,
  COALESCE(h.last_event_at, j.updated_at, now()),
  h.sent_at
FROM legal_jobs j
LEFT JOIN LATERAL (
  SELECT
    bool_or(e.event_type = 'legal_documents_ready_email_sent') AS has_sent,
    bool_or(e.event_type = 'legal_documents_ready_email_delivery_uncertain') AS has_uncertain,
    bool_or(e.event_type = 'legal_documents_ready_email_attempts_exhausted') AS has_exhausted,
    count(*) FILTER (
      WHERE e.event_type = 'legal_documents_ready_email_attempt_started'
    )::integer AS attempt_count,
    max(e.created_at) AS last_event_at,
    max(e.created_at) FILTER (
      WHERE e.event_type = 'legal_documents_ready_email_sent'
    ) AS sent_at,
    EXISTS (
      SELECT 1
      FROM legal_audit_events started
      WHERE started.pair_id = j.pair_id
        AND started.details->>'jobId' = j.id::text
        AND started.event_type = 'legal_documents_ready_email_attempt_started'
        AND NOT EXISTS (
          SELECT 1
          FROM legal_audit_events terminal
          WHERE terminal.pair_id = j.pair_id
            AND terminal.details->>'jobId' = j.id::text
            AND terminal.details->>'attempt' = started.details->>'attempt'
            AND terminal.event_type IN (
              'legal_documents_ready_email_sent',
              'legal_documents_ready_email_failed'
            )
        )
    ) AS has_unresolved
  FROM legal_audit_events e
  WHERE e.pair_id = j.pair_id
    AND e.details->>'jobId' = j.id::text
    AND e.event_type IN (
      'legal_documents_ready_email_attempt_started',
      'legal_documents_ready_email_sent',
      'legal_documents_ready_email_failed',
      'legal_documents_ready_email_delivery_uncertain',
      'legal_documents_ready_email_attempts_exhausted'
    )
) h ON true
WHERE j.kind = 'notify'
ON CONFLICT (pair_id, cycle_number) DO NOTHING;

UPDATE legal_jobs j
SET notification_cycle_id = c.id
FROM legal_notification_cycles c
WHERE j.kind = 'notify'
  AND c.pair_id = j.pair_id
  AND c.cycle_number = 1
  AND j.notification_cycle_id IS NULL;

COMMIT;