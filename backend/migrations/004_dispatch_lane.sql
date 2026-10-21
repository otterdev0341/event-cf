ALTER TABLE attempts ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'new' CHECK(lane IN ('new','fail'));
