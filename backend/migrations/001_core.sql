CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, root boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sessions (
 digest text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours'
);
CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (
 org_id text NOT NULL REFERENCES organizations(id), user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK (role IN ('org_admin','event_admin','team_member')),
 event_ids jsonb NOT NULL DEFAULT '[]', PRIMARY KEY(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS events (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id),
 code text NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 UNIQUE(org_id,code), UNIQUE(org_id,id)
);
CREATE TABLE IF NOT EXISTS knowledge (
 org_id text NOT NULL, event_id text PRIMARY KEY,
 data jsonb NOT NULL DEFAULT '{"categories":[],"categoryRevision":1,"draft":[],"published":[]}',
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE IF NOT EXISTS tickets (
 id text PRIMARY KEY, org_id text NOT NULL, event_id text NOT NULL, data jsonb NOT NULL,
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE IF NOT EXISTS queue_policy (
 org_id text NOT NULL, event_id text PRIMARY KEY, new_weight integer NOT NULL DEFAULT 2 CHECK(new_weight BETWEEN 1 AND 100),
 retry_weight integer NOT NULL DEFAULT 1 CHECK(retry_weight BETWEEN 1 AND 100),
 turn integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 2 CHECK(max_retries BETWEEN 0 AND 10),
 delay_seconds integer NOT NULL DEFAULT 900 CHECK(delay_seconds >= 0),
 status text NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused','cancelled')),
 version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE IF NOT EXISTS participants (
 id text PRIMARY KEY, org_id text NOT NULL, event_id text NOT NULL, phone text NOT NULL, data jsonb NOT NULL,
 lane text NOT NULL DEFAULT 'new' CHECK(lane IN ('new','fail','done')),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','delayed','stopped','awaiting_result')),
 attempt_count integer NOT NULL DEFAULT 0, eligible_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id), UNIQUE(org_id,event_id,phone),
 UNIQUE(org_id,event_id,id)
);
CREATE TABLE IF NOT EXISTS attempts (
 id text PRIMARY KEY, org_id text NOT NULL, event_id text NOT NULL, participant_id text NOT NULL,
 number integer NOT NULL, status text NOT NULL CHECK(status IN ('reserved','uncertain','accepted','completed','rejected')),
 provider_id text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
 FOREIGN KEY(org_id,event_id,participant_id) REFERENCES participants(org_id,event_id,id),
 UNIQUE(participant_id,number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt_per_event ON attempts(event_id)
 WHERE status IN ('reserved','uncertain','accepted');
CREATE TABLE IF NOT EXISTS imports (
 id text PRIMARY KEY, org_id text NOT NULL, event_id text NOT NULL, data jsonb NOT NULL,
 committed boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE IF NOT EXISTS credentials (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), event_id text,
 parent_id text REFERENCES credentials(id), digest text NOT NULL UNIQUE, data jsonb NOT NULL,
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id)
);
CREATE TABLE IF NOT EXISTS idempotency (
 scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
CREATE TABLE IF NOT EXISTS auth_limits (
 key text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS participant_dispatch ON participants(event_id,lane,eligible_at) WHERE state IN ('ready','delayed');
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
