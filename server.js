const express = require('express');
const { Pool } = require('pg');
const path = require('node:path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

function signedIn(req, res, next) {
  if (req.get('X-BoxLite-User-Id')) return next();
  if (req.accepts('html')) return res.redirect(302, '/.boxlite/auth/login?next=/app');
  return res.status(401).json({ error: 'Sign in to access the sales workspace.' });
}

const fields = {
  name: 'name', company: 'company', title: 'title', email: 'email', phone: 'phone',
  source: 'source', status: 'status', owner: 'owner', estimatedValue: 'estimated_value',
  score: 'score', nextStep: 'next_step'
};
const statuses = new Set(['New', 'Working', 'Nurturing', 'Qualified', 'Unqualified', 'Converted', 'Archived']);
const row = (lead) => ({
  id: lead.id, name: lead.name, company: lead.company, title: lead.title, email: lead.email,
  phone: lead.phone, source: lead.source, status: lead.status, owner: lead.owner,
  estimatedValue: lead.estimated_value, score: lead.score, lastActivity: lead.last_activity,
  nextStep: lead.next_step, createdAt: lead.created_at, updatedAt: lead.updated_at
});
const interactionRow = (item) => ({
  id: item.id, leadId: item.lead_id, leadName: item.lead_name, company: item.company,
  interactionDate: item.interaction_date, source: item.source, userTask: item.user_task,
  taskInput: item.task_input, expectedResult: item.expected_result, currentSolution: item.current_solution,
  usageStage: item.usage_stage, completedSteps: item.completed_steps, obstacle: item.obstacle,
  manualAssist: item.manual_assist, evidence: item.evidence, nextStep: item.next_step,
  nextStepDate: dateOnly(item.next_step_date), continuedUse: item.continued_use, productIssue: item.product_issue,
  reproductionInfo: item.reproduction_info, issueCoordinator: item.issue_coordinator, createdAt: item.created_at
});
const eventRow = (item) => ({
  id: item.id, leadId: item.lead_id, leadName: item.lead_name, company: item.company,
  eventType: item.event_type, occurredOn: dateOnly(item.occurred_on), evidence: item.evidence, createdAt: item.created_at
});
function dateOnly(value) {
  if (!value) return '';
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

app.get('/healthz', (_req, res) => res.status(200).type('text').send('ok'));
app.get('/', (_req, res) => res.redirect(302, '/app'));
app.get('/app', signedIn, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use('/api', signedIn);
app.get('/api/me', (req, res) => {
  const decode = (value) => { try { return decodeURIComponent(value || ''); } catch { return value || ''; } };
  res.json({
    id: req.get('X-BoxLite-User-Id'),
    name: decode(req.get('X-BoxLite-User-Name')),
    email: decode(req.get('X-BoxLite-User-Email')),
    role: req.get('X-BoxLite-User-Role') || 'user'
  });
});

app.get('/api/leads', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    const status = String(req.query.status || 'all');
    const owner = String(req.query.owner || 'all');
    const values = [];
    const where = ["status <> 'Archived'"];
    if (status !== 'all') { values.push(status); where.push(`status = $${values.length}`); }
    if (owner !== 'all') { values.push(owner); where.push(`owner = $${values.length}`); }
    if (q) {
      values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      const n = values.length;
      where.push(`(name ILIKE $${n} OR company ILIKE $${n} OR email ILIKE $${n} OR title ILIKE $${n})`);
    }
    const result = await pool.query(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, name ASC`, values);
    res.json({ leads: result.rows.map(row) });
  } catch (error) { next(error); }
});

app.get('/api/adoption', async (_req, res, next) => {
  try {
    const [interactions, events, counts, leads] = await Promise.all([
      pool.query(`SELECT i.*, l.name AS lead_name, l.company FROM lead_interactions i JOIN leads l ON l.id = i.lead_id ORDER BY i.interaction_date DESC LIMIT 200`),
      pool.query(`SELECT e.*, l.name AS lead_name, l.company FROM adoption_events e JOIN leads l ON l.id = e.lead_id ORDER BY e.occurred_on DESC, e.created_at DESC LIMIT 100`),
      pool.query(`SELECT event_type, COUNT(*)::int AS count FROM adoption_events GROUP BY event_type`),
      pool.query(`SELECT id, name, company FROM leads WHERE status <> 'Archived' ORDER BY name ASC`)
    ]);
    const signals = { interest: 0, trial_completed: 0, repeat_use: 0, paid: 0 };
    for (const item of counts.rows) signals[item.event_type] = item.count;
    res.json({ interactions: interactions.rows.map(interactionRow), events: events.rows.map(eventRow), signals, leads: leads.rows });
  } catch (error) { next(error); }
});

app.get('/api/leads/:id/journey', async (req, res, next) => {
  try {
    const lead = await pool.query('SELECT id FROM leads WHERE id = $1', [req.params.id]);
    if (!lead.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    const [interactions, events] = await Promise.all([
      pool.query(`SELECT i.*, l.name AS lead_name, l.company FROM lead_interactions i JOIN leads l ON l.id = i.lead_id WHERE i.lead_id = $1 ORDER BY i.interaction_date DESC`, [req.params.id]),
      pool.query(`SELECT e.*, l.name AS lead_name, l.company FROM adoption_events e JOIN leads l ON l.id = e.lead_id WHERE e.lead_id = $1 ORDER BY e.occurred_on DESC, e.created_at DESC`, [req.params.id])
    ]);
    res.json({ interactions: interactions.rows.map(interactionRow), events: events.rows.map(eventRow) });
  } catch (error) { next(error); }
});

app.post('/api/leads/:id/interactions', async (req, res, next) => {
  try {
    const body = req.body || {};
    const stages = new Set(['pre_trial', 'during_trial', 'after_trial']);
    if (!stages.has(body.usageStage)) return res.status(400).json({ error: 'Choose a trial stage.' });
    if (!String(body.source || '').trim() || !String(body.userTask || '').trim() || !String(body.currentSolution || '').trim()) {
      return res.status(400).json({ error: 'Source, user task, and current solution are required.' });
    }
    if (!String(body.obstacle || '').trim()) return res.status(400).json({ error: 'Record the blocker, or enter “None observed”.' });
    if (!String(body.evidence || '').trim()) return res.status(400).json({ error: 'Add evidence from the conversation or observed trial.' });
    if (body.usageStage === 'pre_trial' && (!String(body.taskInput || '').trim() || !String(body.expectedResult || '').trim())) {
      return res.status(400).json({ error: 'Before a trial, record the input and expected result.' });
    }
    if (body.usageStage === 'during_trial' && !String(body.completedSteps || '').trim()) {
      return res.status(400).json({ error: 'Record the steps completed during the trial.' });
    }
    if (body.usageStage === 'after_trial' && !['unknown', 'yes', 'no'].includes(body.continuedUse)) {
      return res.status(400).json({ error: 'Record whether the user plans to continue using the product.' });
    }
    if (!String(body.nextStep || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.nextStepDate || ''))) {
      return res.status(400).json({ error: 'A next step and follow-up date are required.' });
    }
    if (body.productIssue && (!String(body.reproductionInfo || '').trim() || !String(body.issueCoordinator || '').trim())) {
      return res.status(400).json({ error: 'Add reproduction details and a coordinator for the product issue.' });
    }
    const lead = await pool.query('SELECT id FROM leads WHERE id = $1', [req.params.id]);
    if (!lead.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    const values = [
      req.params.id, String(body.source).trim().slice(0, 100), String(body.userTask).trim().slice(0, 500),
      String(body.taskInput || '').trim().slice(0, 1000), String(body.expectedResult || '').trim().slice(0, 1000),
      String(body.currentSolution).trim().slice(0, 1000), body.usageStage,
      String(body.completedSteps || '').trim().slice(0, 2000), String(body.obstacle || '').trim().slice(0, 2000),
      Boolean(body.manualAssist), String(body.evidence || '').trim().slice(0, 2000),
      String(body.nextStep).trim().slice(0, 500), body.nextStepDate,
      body.usageStage === 'after_trial' ? body.continuedUse : 'unknown', Boolean(body.productIssue),
      String(body.reproductionInfo || '').trim().slice(0, 2000), String(body.issueCoordinator || '').trim().slice(0, 160),
      req.get('X-BoxLite-User-Id')
    ];
    const result = await pool.query(
      `INSERT INTO lead_interactions (lead_id, source, user_task, task_input, expected_result, current_solution, usage_stage, completed_steps, obstacle, manual_assist, evidence, next_step, next_step_date, continued_use, product_issue, reproduction_info, issue_coordinator, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`, values
    );
    const joined = await pool.query('SELECT name AS lead_name, company FROM leads WHERE id = $1', [req.params.id]);
    res.status(201).json({ interaction: interactionRow({ ...result.rows[0], ...joined.rows[0] }) });
  } catch (error) { next(error); }
});

app.post('/api/leads/:id/signals', async (req, res, next) => {
  try {
    const body = req.body || {};
    const eventTypes = new Set(['interest', 'trial_completed', 'repeat_use', 'paid']);
    if (!eventTypes.has(body.eventType)) return res.status(400).json({ error: 'Choose a valid adoption signal.' });
    if (!String(body.evidence || '').trim()) return res.status(400).json({ error: 'Add evidence for this adoption signal.' });
    if (body.occurredOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.occurredOn))) return res.status(400).json({ error: 'Enter a valid event date.' });
    const lead = await pool.query('SELECT id FROM leads WHERE id = $1', [req.params.id]);
    if (!lead.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    const result = await pool.query(
      `INSERT INTO adoption_events (lead_id, event_type, occurred_on, evidence, created_by)
       VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5) RETURNING *`,
      [req.params.id, body.eventType, body.occurredOn || null, String(body.evidence).trim().slice(0, 2000), req.get('X-BoxLite-User-Id')]
    );
    const joined = await pool.query('SELECT name AS lead_name, company FROM leads WHERE id = $1', [req.params.id]);
    res.status(201).json({ event: eventRow({ ...result.rows[0], ...joined.rows[0] }) });
  } catch (error) { next(error); }
});

app.post('/api/leads', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.name || '').trim() || !String(body.company || '').trim()) {
      return res.status(400).json({ error: 'Name and company are required.' });
    }
    const status = statuses.has(body.status) ? body.status : 'New';
    const value = Math.max(0, Number.parseInt(body.estimatedValue, 10) || 0);
    const score = Math.max(0, Math.min(100, Number.parseInt(body.score, 10) || 50));
    const params = [
      String(body.name).trim().slice(0, 120), String(body.company).trim().slice(0, 120),
      String(body.title || '').trim().slice(0, 120), String(body.email || '').trim().slice(0, 200),
      String(body.phone || '').trim().slice(0, 60), String(body.source || 'Website').trim().slice(0, 80),
      status, String(body.owner || 'Sales team').trim().slice(0, 100), value, score,
      String(body.nextStep || 'Follow up').trim().slice(0, 240)
    ];
    const result = await pool.query(
      `INSERT INTO leads (name, company, title, email, phone, source, status, owner, estimated_value, score, last_activity, next_step)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Just added',$11) RETURNING *`, params
    );
    res.status(201).json({ lead: row(result.rows[0]) });
  } catch (error) { next(error); }
});

app.patch('/api/leads/:id', async (req, res, next) => {
  try {
    const updates = [];
    const values = [];
    for (const [key, column] of Object.entries(fields)) {
      if (!(key in (req.body || {}))) continue;
      let value = req.body[key];
      if (key === 'status' && !statuses.has(value)) return res.status(400).json({ error: 'Choose a valid status.' });
      if (key === 'estimatedValue') value = Math.max(0, Number.parseInt(value, 10) || 0);
      if (key === 'score') value = Math.max(0, Math.min(100, Number.parseInt(value, 10) || 0));
      values.push(typeof value === 'string' ? value.trim().slice(0, 240) : value);
      updates.push(`${column} = $${values.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No lead fields to update.' });
    updates.push('updated_at = NOW()', "last_activity = 'Just now'");
    values.push(req.params.id);
    const result = await pool.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    res.json({ lead: row(result.rows[0]) });
  } catch (error) { next(error); }
});

app.delete('/api/leads/:id', async (req, res, next) => {
  try {
    const result = await pool.query("UPDATE leads SET status = 'Archived', updated_at = NOW() WHERE id = $1 AND status <> 'Archived' RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    res.status(200).json({ archived: true });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h' }));
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = app.listen(port, '0.0.0.0', () => console.log(`salecloud listening on ${port}`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const forceExit = setTimeout(() => process.exit(1), 8000);
  forceExit.unref();
  server.close(() => pool.end().finally(() => { clearTimeout(forceExit); process.exit(0); }));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
