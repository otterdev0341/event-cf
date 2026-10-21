ALTER TABLE participants ADD COLUMN IF NOT EXISTS enqueue_seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS participant_fifo ON participants(event_id,lane,eligible_at,enqueue_seq)
 WHERE state IN ('ready','delayed');
