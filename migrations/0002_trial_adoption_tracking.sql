-- trial_adoption_tracking
CREATE TABLE lead_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  interaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  user_task TEXT NOT NULL,
  task_input TEXT NOT NULL DEFAULT '',
  expected_result TEXT NOT NULL DEFAULT '',
  current_solution TEXT NOT NULL DEFAULT '',
  usage_stage TEXT NOT NULL CHECK (usage_stage IN ('pre_trial', 'during_trial', 'after_trial')),
  completed_steps TEXT NOT NULL DEFAULT '',
  obstacle TEXT NOT NULL DEFAULT '',
  manual_assist BOOLEAN NOT NULL DEFAULT FALSE,
  evidence TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL,
  next_step_date DATE NOT NULL,
  continued_use TEXT NOT NULL DEFAULT 'unknown' CHECK (continued_use IN ('unknown', 'yes', 'no')),
  product_issue BOOLEAN NOT NULL DEFAULT FALSE,
  reproduction_info TEXT NOT NULL DEFAULT '',
  issue_coordinator TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX lead_interactions_lead_date_idx ON lead_interactions (lead_id, interaction_date DESC);
CREATE INDEX lead_interactions_follow_up_idx ON lead_interactions (next_step_date);

CREATE TABLE adoption_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('interest', 'trial_completed', 'repeat_use', 'paid')),
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  evidence TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX adoption_events_lead_date_idx ON adoption_events (lead_id, occurred_on DESC);
CREATE INDEX adoption_events_type_date_idx ON adoption_events (event_type, occurred_on DESC);
