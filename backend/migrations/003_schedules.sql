ALTER TABLE participants ADD COLUMN IF NOT EXISTS cycle_base integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS schedules (
 id text PRIMARY KEY, org_id text NOT NULL, event_id text NOT NULL,
 user_id text NOT NULL REFERENCES users(id), event_version integer NOT NULL,
 data jsonb NOT NULL, next_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','running','completed','cancelled','failed')),
 version integer NOT NULL DEFAULT 1, completed_runs integer NOT NULL DEFAULT 0,
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_schedule ON schedules(event_id)
 WHERE status IN ('scheduled','running');
CREATE TABLE IF NOT EXISTS schedule_occurrences (
 id text PRIMARY KEY, schedule_id text NOT NULL REFERENCES schedules(id),
 scheduled_at timestamptz NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(schedule_id,scheduled_at)
);
