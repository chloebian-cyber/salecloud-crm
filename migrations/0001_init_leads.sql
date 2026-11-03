-- init_leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Website',
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Working', 'Nurturing', 'Qualified', 'Unqualified', 'Converted', 'Archived')),
  owner TEXT NOT NULL DEFAULT 'Sales team',
  estimated_value INTEGER NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  score INTEGER NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  last_activity TEXT NOT NULL DEFAULT 'Just now',
  next_step TEXT NOT NULL DEFAULT 'Follow up',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);
CREATE INDEX IF NOT EXISTS leads_updated_idx ON leads (updated_at DESC);

-- Fresh installs start empty. The hosted workspace may include fictional sample leads.
