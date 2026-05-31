import express from 'express'
import cors from 'cors'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'

const execFileAsync = promisify(execFile)

const app = express()
const PORT = Number(process.env.PORT || 8080)
const API_TOKEN = process.env.HERMES_WEB_TOKEN || ''
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const HERMES_HOME = process.env.HERMES_HOME || '/root/.hermes'
const FIREFLY_BASE_URL = (process.env.FIREFLY_BASE_URL || 'http://localhost:8090').replace(/\/$/, '')
const FIREFLY_API_TOKEN = process.env.FIREFLY_API_TOKEN || ''

const AGENT_STORE_DIR = path.join(HERMES_HOME, 'control-center')
const AGENT_STORE_FILE = path.join(AGENT_STORE_DIR, 'multi-agents.json')
const KANBAN_STATES = ['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done', 'archived']

app.use(cors())
app.use(express.json({ limit: '1mb' }))

function requireAuth(req, res, next) {
  if (!API_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: 'HERMES_WEB_TOKEN is not configured on the server.',
    })
  }

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (token !== API_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  next()
}

async function runHermes(args = [], timeout = 120000) {
  const env = {
    ...process.env,
    HERMES_HOME,
  }

  try {
    const { stdout, stderr } = await execFileAsync(HERMES_BIN, args, {
      timeout,
      maxBuffer: 6 * 1024 * 1024,
      env,
    })

    return {
      ok: true,
      args,
      stdout: stdout?.trim() || '',
      stderr: stderr?.trim() || '',
    }
  } catch (error) {
    return {
      ok: false,
      args,
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || '',
      error: error.message,
      exitCode: typeof error.code === 'number' ? error.code : null,
    }
  }
}

function parseJsonSafe(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function ensureAgentStore() {
  fs.mkdirSync(AGENT_STORE_DIR, { recursive: true })
  if (!fs.existsSync(AGENT_STORE_FILE)) {
    fs.writeFileSync(AGENT_STORE_FILE, '[]\n', 'utf8')
  }
}

function readAgents() {
  ensureAgentStore()
  const raw = fs.readFileSync(AGENT_STORE_FILE, 'utf8')
  const parsed = parseJsonSafe(raw, [])
  if (!Array.isArray(parsed)) return []
  return parsed
}

function writeAgents(agents) {
  ensureAgentStore()
  fs.writeFileSync(AGENT_STORE_FILE, JSON.stringify(agents, null, 2) + '\n', 'utf8')
}

function normalizeSkills(skills) {
  if (Array.isArray(skills)) {
    return skills.map((x) => String(x).trim()).filter(Boolean)
  }
  if (typeof skills === 'string') {
    return skills
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return []
}

async function fireflyRequest(pathname, query = {}) {
  if (!FIREFLY_BASE_URL) {
    throw new Error('FIREFLY_BASE_URL is not configured')
  }
  if (!FIREFLY_API_TOKEN) {
    throw new Error('FIREFLY_API_TOKEN is not configured. Create a Firefly III Personal Access Token and add it to the control-center environment.')
  }

  const url = new URL(`${FIREFLY_BASE_URL}${pathname}`)
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${FIREFLY_API_TOKEN}`,
      'User-Agent': 'Hermes-Control-Center/1.0',
    },
  })
  const text = await res.text()
  const data = parseJsonSafe(text, text)
  if (!res.ok) {
    throw new Error(`Firefly API ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

function parseKanbanTask(result) {
  if (!result?.ok) return null
  const parsed = parseJsonSafe(result.stdout, null)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  const match = String(result.stdout || '').match(/\b(t_[a-f0-9]+)\b/i)
  return match ? { id: match[1] } : null
}

async function createKanbanTask({ title, body, assignee, priority, state }) {
  const targetState = KANBAN_STATES.includes(state) ? state : 'ready'
  const args = ['kanban', 'create', title, '--json', '--created-by', 'control-center']

  if (body) args.push('--body', body)
  if (assignee) args.push('--assignee', assignee)
  if (Number.isFinite(priority)) args.push('--priority', String(priority))
  if (targetState === 'triage') args.push('--triage')
  if (targetState === 'blocked' || targetState === 'running') args.push('--initial-status', targetState)

  const createResult = await runHermes(args, 90000)
  if (!createResult.ok) return { ok: false, createResult, error: createResult.error || createResult.stderr || 'Failed to create task' }

  const task = parseKanbanTask(createResult)
  const taskId = task?.id
  const transitions = []
  let warning = ''

  if (taskId) {
    if (targetState === 'scheduled') {
      transitions.push(await runHermes(['kanban', 'schedule', taskId, 'Created from Control Center in Scheduled'], 90000))
    } else if (targetState === 'done') {
      transitions.push(await runHermes(['kanban', 'complete', taskId, '--result', 'Created from Control Center as already done'], 90000))
    } else if (targetState === 'archived') {
      transitions.push(await runHermes(['kanban', 'archive', taskId], 90000))
    } else if (targetState === 'todo' || targetState === 'review') {
      warning = `Hermes CLI does not expose direct manual creation in ${targetState}; created the card in ${task.status || 'ready'} instead.`
    }
  } else {
    warning = 'Task was created, but the API could not parse its id for follow-up transitions.'
  }

  const failedTransition = transitions.find((result) => !result.ok)
  if (failedTransition) {
    return { ok: false, createResult, task, transitions, error: failedTransition.error || failedTransition.stderr || 'Task created but follow-up transition failed' }
  }

  return { ok: true, createResult, task, transitions, warning }
}

function compactCollection(data, fields = [], limit = 20) {
  const rows = Array.isArray(data?.data) ? data.data.slice(0, limit) : []
  return rows.map((row) => {
    const attrs = row?.attributes || {}
    const item = { id: row?.id }
    fields.forEach((field) => { item[field] = attrs[field] })
    return item
  })
}

function compactTransactions(data, limit = 10) {
  const rows = Array.isArray(data?.data) ? data.data : []
  const txs = []
  for (const row of rows) {
    const transactions = row?.attributes?.transactions || []
    for (const tx of transactions) {
      txs.push({
        journal_id: tx.transaction_journal_id,
        group_id: row.id,
        type: tx.type,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        currency_code: tx.currency_code,
        source_name: tx.source_name,
        destination_name: tx.destination_name,
        category_name: tx.category_name,
        tags: tx.tags || [],
      })
      if (txs.length >= limit) return txs
    }
  }
  return txs
}

function financeAgentDefinition() {
  const now = new Date().toISOString()
  return {
    id: 'agent_personal_finance_firefly',
    name: 'Raul — Personal Finance Agent',
    model: 'gpt-5.5',
    provider: 'openai-codex',
    skills: ['firefly-finance-agent'],
    rules: 'You are Raul, Jose personal finance agent. Use the firefly-finance-agent skill. Firefly III is the source of truth. Register transactions automatically only when confidence is high and no critical fields are blank or ambiguous. If confidence is not high, show a concise preview and ask one concrete question. Never create categories or tags; infer from existing Firefly history.',
    context: 'Raul can be invoked from the Control Center or Telegram with messages like “Raul, gasto de 25.000, almuerzos” or “Raul, analiza mis gastos este mes”. Focus on registering movements, analyzing Firefly data, summaries, and advice. Do not build dashboards.',
    createdAt: now,
    updatedAt: now,
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hermes-control-center-api',
    hermesBin: HERMES_BIN,
  })
})

app.use('/api', requireAuth)

app.get('/api/auth/verify', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/hermes/overview', async (_req, res) => {
  const [status, tools, skills, profiles, configPath] = await Promise.all([
    runHermes(['status', '--all'], 120000),
    runHermes(['tools', 'list'], 90000),
    runHermes(['skills', 'list'], 90000),
    runHermes(['profile', 'list'], 90000),
    runHermes(['config', 'path'], 30000),
  ])

  res.json({
    ok: true,
    status,
    tools,
    skills,
    profiles,
    configPath,
  })
})

app.get('/api/hermes/kanban', async (_req, res) => {
  const list = await runHermes(['kanban', 'list'], 90000)
  const stats = await runHermes(['kanban', 'stats'], 90000)
  res.json({ ok: true, list, stats })
})

app.get('/api/hermes/kanban/board', async (_req, res) => {
  const tasksByState = {}
  for (const state of KANBAN_STATES) {
    const result = await runHermes(['kanban', 'list', '--status', state, '--json'], 90000)
    const tasks = result.ok ? parseJsonSafe(result.stdout, []) : []
    tasksByState[state] = Array.isArray(tasks) ? tasks : []
  }

  res.json({ ok: true, states: KANBAN_STATES, tasksByState })
})

app.get('/api/hermes/kanban/assignees', async (_req, res) => {
  const result = await runHermes(['kanban', 'assignees', '--json'], 90000)
  const parsed = result.ok ? parseJsonSafe(result.stdout, []) : []
  const assignees = Array.isArray(parsed)
    ? parsed
      .map((item) => (typeof item === 'string' ? item : item?.profile || item?.assignee || item?.name))
      .filter((name) => name && name !== 'none')
    : []
  res.status(result.ok ? 200 : 500).json({ ok: result.ok, assignees: [...new Set(assignees)], raw: result })
})

app.post('/api/hermes/kanban/tasks', async (req, res) => {
  const { title, body, assignee, priority, state } = req.body || {}
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ ok: false, error: 'title is required' })
  }

  const targetState = typeof state === 'string' && KANBAN_STATES.includes(state) ? state : 'ready'
  const parsedPriority = priority === undefined || priority === '' ? undefined : Number(priority)
  if (parsedPriority !== undefined && !Number.isFinite(parsedPriority)) {
    return res.status(400).json({ ok: false, error: 'priority must be a number' })
  }

  const result = await createKanbanTask({
    title: title.trim(),
    body: typeof body === 'string' ? body.trim() : '',
    assignee: typeof assignee === 'string' && assignee.trim() && assignee.trim() !== 'none' ? assignee.trim() : '',
    priority: parsedPriority,
    state: targetState,
  })

  res.status(result.ok ? 200 : 500).json({
    ...result,
    message: result.warning || `Created Kanban task${result.task?.id ? ` ${result.task.id}` : ''} in ${targetState}.`,
  })
})

app.post('/api/hermes/kanban/tasks/:id/assign', async (req, res) => {
  const { id } = req.params
  const { assignee } = req.body || {}
  const profile = typeof assignee === 'string' && assignee.trim() ? assignee.trim() : 'none'
  const result = await runHermes(['kanban', 'assign', id, profile], 90000)
  res.status(result.ok ? 200 : 500).json({
    ok: result.ok,
    result,
    message: result.ok ? `Assigned ${id} to ${profile}.` : (result.error || result.stderr || 'Failed to assign task'),
  })
})

app.get('/api/hermes/cron', async (_req, res) => {
  const jobs = await runHermes(['cron', 'list', '--all'], 90000)
  res.json({ ok: true, jobs })
})

app.get('/api/hermes/sessions', async (_req, res) => {
  const sessions = await runHermes(['sessions', 'list'], 90000)
  res.json({ ok: true, sessions })
})

app.get('/api/finance/status', async (_req, res) => {
  try {
    const [about, accounts, categories, tags, transactions] = await Promise.all([
      fireflyRequest('/api/v1/about'),
      fireflyRequest('/api/v1/accounts', { type: 'asset', limit: 20 }),
      fireflyRequest('/api/v1/categories', { limit: 40 }),
      fireflyRequest('/api/v1/tags', { limit: 40 }),
      fireflyRequest('/api/v1/transactions', { limit: 10, page: 1 }),
    ])

    res.json({
      ok: true,
      configured: true,
      baseUrl: FIREFLY_BASE_URL,
      about: about?.data || about,
      accounts: compactCollection(accounts, ['name', 'type', 'active', 'current_balance', 'currency_code'], 20),
      categories: compactCollection(categories, ['name', 'spent', 'earned', 'currency_code'], 40),
      tags: compactCollection(tags, ['tag', 'description'], 40),
      recentTransactions: compactTransactions(transactions, 10),
    })
  } catch (error) {
    res.status(200).json({
      ok: false,
      configured: Boolean(FIREFLY_API_TOKEN),
      baseUrl: FIREFLY_BASE_URL,
      error: error.message,
    })
  }
})

app.post('/api/finance/agent/bootstrap', (_req, res) => {
  const agents = readAgents()
  const definition = financeAgentDefinition()
  const idx = agents.findIndex((agent) => agent.id === definition.id || agent.name === definition.name)
  const next = idx >= 0
    ? { ...agents[idx], ...definition, createdAt: agents[idx].createdAt || definition.createdAt, updatedAt: new Date().toISOString() }
    : definition

  if (idx >= 0) agents[idx] = next
  else agents.push(next)

  writeAgents(agents)
  res.json({ ok: true, agent: next })
})

app.post('/api/finance/agent/run', async (req, res) => {
  const { prompt } = req.body || {}
  const userPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : 'Analyze my current finances and give me practical recommendations.'
  const composedPrompt = [
    'Act as Raul, Jose personal finance agent, using the firefly-finance-agent skill.',
    'Use live Firefly III data as the source of truth. Register transactions automatically only when confidence is high and no critical fields are blank or ambiguous. If not high confidence, show a concise preview and ask one concrete question. Never create new categories or tags.',
    `Firefly API configured: ${Boolean(FIREFLY_API_TOKEN)}. Base URL: ${FIREFLY_BASE_URL}.`,
    `Jose request: ${userPrompt}`,
  ].join('\n\n')

  const args = ['chat', '-q', composedPrompt, '-s', 'firefly-finance-agent', '-m', 'gpt-5.5', '--provider', 'openai-codex']
  const result = await runHermes(args, 240000)
  res.status(result.ok ? 200 : 500).json(result)
})

app.post('/api/hermes/chat', async (req, res) => {
  const { query, model, provider, skills } = req.body || {}

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ ok: false, error: 'query is required' })
  }

  const args = ['chat', '-q', query]
  if (model && typeof model === 'string') args.push('-m', model)
  if (provider && typeof provider === 'string') args.push('--provider', provider)

  const normalizedSkills = normalizeSkills(skills)
  if (normalizedSkills.length) {
    args.push('-s', normalizedSkills.join(','))
  }

  const result = await runHermes(args, 180000)
  res.status(result.ok ? 200 : 500).json(result)
})

app.post('/api/hermes/config/set', async (req, res) => {
  const { key, value } = req.body || {}

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, error: 'key is required' })
  }

  const valueString = String(value ?? '')
  const result = await runHermes(['config', 'set', key, valueString], 60000)
  res.status(result.ok ? 200 : 500).json(result)
})

const ALLOWED_COMMANDS = new Set([
  'status',
  'tools',
  'skills',
  'cron',
  'kanban',
  'profile',
  'sessions',
  'doctor',
  'gateway',
  'config',
  'model',
])

app.post('/api/hermes/command', async (req, res) => {
  const { args } = req.body || {}

  if (!Array.isArray(args) || args.length === 0) {
    return res.status(400).json({ ok: false, error: 'args[] is required' })
  }

  const cmd = String(args[0] || '')
  if (!ALLOWED_COMMANDS.has(cmd)) {
    return res.status(403).json({
      ok: false,
      error: `Command '${cmd}' is not allowed via web API`,
      allowed: [...ALLOWED_COMMANDS],
    })
  }

  const stringArgs = args.map((a) => String(a))
  const result = await runHermes(stringArgs, 180000)
  res.status(result.ok ? 200 : 500).json(result)
})

app.get('/api/multi-agents', (_req, res) => {
  const agents = readAgents()
  res.json({ ok: true, agents })
})

app.post('/api/multi-agents', (req, res) => {
  const { name, model, provider, skills, toolsets, rules, context } = req.body || {}
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' })
  }

  const agents = readAgents()
  const now = new Date().toISOString()
  const agent = {
    id: `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    model: typeof model === 'string' ? model.trim() : '',
    provider: typeof provider === 'string' ? provider.trim() : '',
    skills: normalizeSkills(skills),
    toolsets: normalizeStringList(toolsets),
    rules: typeof rules === 'string' ? rules : '',
    context: typeof context === 'string' ? context : '',
    createdAt: now,
    updatedAt: now,
  }

  agents.push(agent)
  writeAgents(agents)
  res.json({ ok: true, agent })
})

app.put('/api/multi-agents/:id', (req, res) => {
  const { id } = req.params
  const agents = readAgents()
  const idx = agents.findIndex((a) => a.id === id)
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Agent not found' })

  const current = agents[idx]
  const next = {
    ...current,
    name: typeof req.body?.name === 'string' ? req.body.name.trim() : current.name,
    model: typeof req.body?.model === 'string' ? req.body.model.trim() : current.model,
    provider: typeof req.body?.provider === 'string' ? req.body.provider.trim() : current.provider,
    skills: req.body?.skills !== undefined ? normalizeSkills(req.body.skills) : current.skills,
    toolsets: req.body?.toolsets !== undefined ? normalizeStringList(req.body.toolsets) : current.toolsets,
    rules: typeof req.body?.rules === 'string' ? req.body.rules : current.rules,
    context: typeof req.body?.context === 'string' ? req.body.context : current.context,
    updatedAt: new Date().toISOString(),
  }

  agents[idx] = next
  writeAgents(agents)
  res.json({ ok: true, agent: next })
})

app.delete('/api/multi-agents/:id', (req, res) => {
  const { id } = req.params
  const agents = readAgents()
  const next = agents.filter((a) => a.id !== id)
  if (next.length === agents.length) return res.status(404).json({ ok: false, error: 'Agent not found' })
  writeAgents(next)
  res.json({ ok: true })
})

app.post('/api/multi-agents/:id/run', async (req, res) => {
  const { id } = req.params
  const { prompt } = req.body || {}
  const agents = readAgents()
  const agent = agents.find((a) => a.id === id)
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' })

  const userPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : 'Report your current status briefly.'
  const composedPrompt = [agent.rules, agent.context, userPrompt].filter(Boolean).join('\n\n')

  const args = ['chat', '-q', composedPrompt]
  if (agent.model) args.push('-m', agent.model)
  if (agent.provider) args.push('--provider', agent.provider)
  if (Array.isArray(agent.toolsets) && agent.toolsets.length) args.push('-t', agent.toolsets.join(','))
  if (Array.isArray(agent.skills) && agent.skills.length) args.push('-s', agent.skills.join(','))

  const result = await runHermes(args, 180000)
  res.status(result.ok ? 200 : 500).json({ ok: result.ok, agent, result })
})

const distPath = path.resolve('dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Hermes Control Center API listening on :${PORT}`)
  console.log(`Using Hermes binary: ${HERMES_BIN}`)
})
