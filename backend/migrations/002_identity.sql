CREATE TABLE IF NOT EXISTS auth_tokens (
 digest text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('reset','invite')),
 email text NOT NULL, data jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour', consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS mail_outbox (
 id text PRIMARY KEY, recipient text NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now()
);
