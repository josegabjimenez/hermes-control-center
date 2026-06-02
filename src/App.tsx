/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from 'react'

type SectionKey =
  | 'dashboard'
  | 'agents'
  | 'kanban'
  | 'multi-agent'
  | 'collaboration'
  | 'finance'
  | 'models'
  | 'skills'
  | 'cron'
  | 'sessions'
  | 'command'
  | 'chat'

type ApiResult = {
  ok: boolean
  stdout?: string
  stderr?: string
  error?: string
}

type MultiAgent = {
  id: string
  name: string
  model: string
  provider?: string
  skills: string[]
  toolsets?: string[]
  rules: string
  context: string
  createdAt: string
  updatedAt: string
}

type KanbanTaskForm = {
  title: string
  body: string
  assignee: string
  priority: string
}

type KanbanAssigneeOption = {
  value: string
  label: string
  kind: 'profile' | 'agent'
}

type CollaborationMessage = {
  id: string
  author: string
  role?: string
  body: string
  createdAt: string
}

type CollaborationTask = {
  id: string
  taskId?: string
  from: string
  to: string
  type: string
  question: string
  requiredOutput: string
  status: string
  approvalRequired: boolean
  messages: CollaborationMessage[]
  createdAt: string
  updatedAt: string
}

type CollaborationAgent = {
  id: string
  name: string
  role?: string
  canCollaborateWith?: string[]
}

const sections: Array<{ key: SectionKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'agents', label: 'Agents / Status' },
  { key: 'kanban', label: 'Kanban Board' },
  { key: 'multi-agent', label: 'Multi Agent' },
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'finance', label: 'Finance Agent' },
  { key: 'models', label: 'Models / Config' },
  { key: 'skills', label: 'Skills' },
  { key: 'cron', label: 'Cron Jobs' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'command', label: 'Command Runner' },
  { key: 'chat', label: 'Hermes Chat' },
]

const kanbanStateOrder = ['triage', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done', 'archived'] as const
type KanbanState = (typeof kanbanStateOrder)[number]

const emptyKanbanTaskForm: KanbanTaskForm = { title: '', body: '', assignee: '', priority: '' }

function makeKanbanForms() {
  return Object.fromEntries(kanbanStateOrder.map((state) => [state, { ...emptyKanbanTaskForm }])) as Record<KanbanState, KanbanTaskForm>
}

function truncate(text: string, len = 9000) {
  if (text.length <= len) return text
  return `${text.slice(0, len)}\n\n...[truncated]`
}

function titleCase(text: string) {
  return text
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function App() {
  const [active, setActive] = useState<SectionKey>('dashboard')
  const [token, setToken] = useState('')
  const [authInput, setAuthInput] = useState(localStorage.getItem('hermes_web_token') || '')
  const [authenticated, setAuthenticated] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [authError, setAuthError] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [overview, setOverview] = useState<any>(null)
  const [kanban, setKanban] = useState<any>(null)
  const [kanbanBoard, setKanbanBoard] = useState<any>(null)
  const [kanbanAssignees, setKanbanAssignees] = useState<KanbanAssigneeOption[]>([])
  const [kanbanForms, setKanbanForms] = useState<Record<KanbanState, KanbanTaskForm>>(makeKanbanForms)
  const [kanbanActionMessage, setKanbanActionMessage] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [cron, setCron] = useState<any>(null)
  const [sessions, setSessions] = useState<any>(null)

  const [agents, setAgents] = useState<MultiAgent[]>([])
  const [agentForm, setAgentForm] = useState({ name: '', model: '', skills: '', rules: '', context: '' })
  const [runPromptByAgent, setRunPromptByAgent] = useState<Record<string, string>>({})
  const [runOutputByAgent, setRunOutputByAgent] = useState<Record<string, string>>({})

  const [collaborationAgents, setCollaborationAgents] = useState<CollaborationAgent[]>([])
  const [collaborationTasks, setCollaborationTasks] = useState<CollaborationTask[]>([])
  const [handoffForm, setHandoffForm] = useState({
    from: 'pipo',
    to: 'megan',
    type: 'financial_code_review',
    taskId: '',
    question: 'Megan, antes de tocar código financiero: ¿ves riesgos o criterios que deba validar?',
    requiredOutput: 'Lista riesgos, datos necesarios y recomendación approve/block.',
  })
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({})
  const [collaborationMessage, setCollaborationMessage] = useState('')

  const [financeStatus, setFinanceStatus] = useState<any>(null)
  const [financePrompt, setFinancePrompt] = useState('Raul, analiza mis gastos este mes y dame recomendaciones prácticas.')
  const [financeOutput, setFinanceOutput] = useState('')

  const [commandArgs, setCommandArgs] = useState('status --all')
  const [commandOutput, setCommandOutput] = useState('')

  const [chatQuery, setChatQuery] = useState('Summarize current Hermes status in bullet points.')
  const [chatModel, setChatModel] = useState('')
  const [chatProvider, setChatProvider] = useState('')
  const [chatOutput, setChatOutput] = useState('')

  const authedHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }),
    [token],
  )

  async function fetchJson(path: string, options?: RequestInit) {
    const res = await fetch(path, options)
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.error || `Request failed: ${res.status}`)
    }
    return data
  }

  async function verifyToken(candidateToken: string) {
    const res = await fetch('/api/auth/verify', {
      headers: {
        Authorization: `Bearer ${candidateToken}`,
      },
    })
    return res.ok
  }

  async function loginWithToken(candidateToken: string) {
    setAuthChecking(true)
    setAuthError('')
    const ok = await verifyToken(candidateToken)
    if (!ok) {
      setAuthenticated(false)
      setAuthError('Wrong password/token. Please try again.')
      setAuthChecking(false)
      return
    }

    setToken(candidateToken)
    setAuthenticated(true)
    localStorage.setItem('hermes_web_token', candidateToken)
    setAuthChecking(false)
  }

  function logout() {
    setAuthenticated(false)
    setToken('')
    setAuthInput('')
    localStorage.removeItem('hermes_web_token')
  }

  async function loadOverview() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/hermes/overview', { headers: authedHeaders })
      setOverview(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }

  async function loadKanban() {
    setLoading(true)
    setError('')
    try {
      const [raw, board, assignees] = await Promise.all([
        fetchJson('/api/hermes/kanban', { headers: authedHeaders }),
        fetchJson('/api/hermes/kanban/board', { headers: authedHeaders }),
        fetchJson('/api/hermes/kanban/assignees', { headers: authedHeaders }),
      ])
      setKanban(raw)
      setKanbanBoard(board)
      const options = Array.isArray(assignees.options)
        ? assignees.options
        : (Array.isArray(assignees.assignees) ? assignees.assignees : []).map((value: string) => ({ value, label: value, kind: 'profile' }))
      setKanbanAssignees(options)
    } catch (e: any) {
      setError(e.message || 'Failed to load kanban')
    } finally {
      setLoading(false)
    }
  }


  function updateKanbanForm(state: KanbanState, patch: Partial<KanbanTaskForm>) {
    setKanbanForms((prev) => ({
      ...prev,
      [state]: { ...prev[state], ...patch },
    }))
  }

  async function createKanbanTask(state: KanbanState) {
    const form = kanbanForms[state]
    if (!form.title.trim()) {
      setError('Task title is required.')
      return
    }

    setLoading(true)
    setError('')
    setKanbanActionMessage('')
    try {
      const data = await fetchJson('/api/hermes/kanban/tasks', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          assignee: form.assignee || undefined,
          priority: form.priority ? Number(form.priority) : undefined,
          state,
        }),
      })
      updateKanbanForm(state, { ...emptyKanbanTaskForm })
      setKanbanActionMessage(data.message || `Created task ${data.task?.id || ''}`)
      await loadKanban()
    } catch (e: any) {
      setError(e.message || 'Failed to create Kanban task')
    } finally {
      setLoading(false)
    }
  }

  async function assignKanbanTask(taskId: string, assignee: string) {
    if (!taskId) return
    setLoading(true)
    setError('')
    setKanbanActionMessage('')
    try {
      const data = await fetchJson(`/api/hermes/kanban/tasks/${encodeURIComponent(taskId)}/assign`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ assignee: assignee || 'none' }),
      })
      setKanbanActionMessage(data.message || `Updated assignee for ${taskId}`)
      await loadKanban()
    } catch (e: any) {
      setError(e.message || 'Failed to assign Kanban task')
    } finally {
      setLoading(false)
    }
  }

  async function loadCron() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/hermes/cron', { headers: authedHeaders })
      setCron(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load cron')
    } finally {
      setLoading(false)
    }
  }

  async function loadSessions() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/hermes/sessions', { headers: authedHeaders })
      setSessions(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  async function loadMultiAgents() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/multi-agents', { headers: authedHeaders })
      setAgents(Array.isArray(data.agents) ? data.agents : [])
    } catch (e: any) {
      setError(e.message || 'Failed to load multi-agents')
    } finally {
      setLoading(false)
    }
  }

  async function loadCollaboration() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/agent-collaboration/tasks', { headers: authedHeaders })
      setCollaborationTasks(Array.isArray(data.tasks) ? data.tasks : [])
      setCollaborationAgents(Array.isArray(data.agents) ? data.agents : [])
    } catch (e: any) {
      setError(e.message || 'Failed to load collaboration tasks')
    } finally {
      setLoading(false)
    }
  }

  async function createHandoff() {
    if (!handoffForm.question.trim()) {
      setError('Question is required for a handoff.')
      return
    }

    setLoading(true)
    setError('')
    setCollaborationMessage('')
    try {
      const data = await fetchJson('/api/agent-handoff', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify(handoffForm),
      })
      setCollaborationMessage(`Created handoff ${data.task?.id || ''} (${data.task?.status || 'open'}).`)
      setHandoffForm((prev) => ({ ...prev, taskId: '', question: '' }))
      await loadCollaboration()
    } catch (e: any) {
      setError(e.message || 'Failed to create handoff')
    } finally {
      setLoading(false)
    }
  }

  async function addCollaborationMessage(task: CollaborationTask, status?: string) {
    const body = messageDrafts[task.id] || ''
    if (!body.trim()) {
      setError('Message body is required.')
      return
    }

    setLoading(true)
    setError('')
    setCollaborationMessage('')
    try {
      await fetchJson(`/api/agent-collaboration/tasks/${encodeURIComponent(task.id)}/messages`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ author: task.to, body, status }),
      })
      setMessageDrafts((prev) => ({ ...prev, [task.id]: '' }))
      setCollaborationMessage(`Updated ${task.id}.`)
      await loadCollaboration()
    } catch (e: any) {
      setError(e.message || 'Failed to add collaboration message')
    } finally {
      setLoading(false)
    }
  }

  async function createMultiAgent() {
    setLoading(true)
    setError('')
    try {
      await fetchJson('/api/multi-agents', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify(agentForm),
      })
      setAgentForm({ name: '', model: '', skills: '', rules: '', context: '' })
      await loadMultiAgents()
    } catch (e: any) {
      setError(e.message || 'Failed to create multi-agent')
    } finally {
      setLoading(false)
    }
  }

  async function updateMultiAgent(agent: MultiAgent) {
    setLoading(true)
    setError('')
    try {
      await fetchJson(`/api/multi-agents/${agent.id}`, {
        method: 'PUT',
        headers: authedHeaders,
        body: JSON.stringify(agent),
      })
      await loadMultiAgents()
    } catch (e: any) {
      setError(e.message || 'Failed to update multi-agent')
    } finally {
      setLoading(false)
    }
  }

  async function deleteMultiAgent(id: string) {
    setLoading(true)
    setError('')
    try {
      await fetchJson(`/api/multi-agents/${id}`, {
        method: 'DELETE',
        headers: authedHeaders,
      })
      await loadMultiAgents()
    } catch (e: any) {
      setError(e.message || 'Failed to delete multi-agent')
    } finally {
      setLoading(false)
    }
  }

  async function runMultiAgent(id: string) {
    setLoading(true)
    setError('')
    try {
      const payload = {
        prompt: runPromptByAgent[id] || 'Give me a concise status update.',
      }
      const data = await fetchJson(`/api/multi-agents/${id}/run`, {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify(payload),
      })
      const out = data?.result?.stdout || data?.result?.stderr || data?.result?.error || ''
      setRunOutputByAgent((prev) => ({ ...prev, [id]: truncate(String(out), 5000) }))
    } catch (e: any) {
      setError(e.message || 'Failed to run multi-agent')
    } finally {
      setLoading(false)
    }
  }

  async function loadFinanceStatus() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson('/api/finance/status', { headers: authedHeaders })
      setFinanceStatus(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load finance status')
    } finally {
      setLoading(false)
    }
  }

  async function bootstrapFinanceAgent() {
    setLoading(true)
    setError('')
    try {
      await fetchJson('/api/finance/agent/bootstrap', {
        method: 'POST',
        headers: authedHeaders,
      })
      await loadMultiAgents()
      setActive('multi-agent')
    } catch (e: any) {
      setError(e.message || 'Failed to create finance agent')
    } finally {
      setLoading(false)
    }
  }

  async function runFinanceAgent() {
    setLoading(true)
    setError('')
    setFinanceOutput('')
    try {
      const data: ApiResult = await fetchJson('/api/finance/agent/run', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ prompt: financePrompt }),
      })
      setFinanceOutput(truncate((data.stdout || data.stderr || data.error || '').trim(), 12000))
    } catch (e: any) {
      setError(e.message || 'Finance agent failed')
    } finally {
      setLoading(false)
    }
  }

  async function runCommand() {
    setLoading(true)
    setError('')
    setCommandOutput('')
    try {
      const args = commandArgs
        .split(' ')
        .map((x) => x.trim())
        .filter(Boolean)
      const data: ApiResult = await fetchJson('/api/hermes/command', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ args }),
      })
      setCommandOutput(truncate((data.stdout || data.stderr || '').trim()))
    } catch (e: any) {
      setError(e.message || 'Command failed')
    } finally {
      setLoading(false)
    }
  }

  async function runChat() {
    setLoading(true)
    setError('')
    setChatOutput('')
    try {
      const data: ApiResult = await fetchJson('/api/hermes/chat', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({
          query: chatQuery,
          model: chatModel || undefined,
          provider: chatProvider || undefined,
        }),
      })
      setChatOutput(truncate((data.stdout || data.stderr || '').trim(), 12000))
    } catch (e: any) {
      setError(e.message || 'Chat failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('hermes_web_token') || ''
    if (!stored) {
      setAuthChecking(false)
      return
    }

    loginWithToken(stored)
  }, [])

  useEffect(() => {
    if (!authenticated) return
    loadOverview()
    loadMultiAgents()
    loadCollaboration()
  }, [authenticated])

  const statusPreview = overview?.status?.stdout || 'No data loaded yet.'
  const skillsPreview = overview?.skills?.stdout || 'No data loaded yet.'
  const toolsPreview = overview?.tools?.stdout || 'No data loaded yet.'

  if (authChecking) {
    return (
      <div className="auth-screen">
        <div className="auth-card"><h1>Checking access...</h1></div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="auth-screen">
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault()
            loginWithToken(authInput)
          }}
        >
          <h1>Hermes Control Center</h1>
          <p className="lead">Enter your password to unlock the app.</p>
          <label className="token-label">Password / API Token</label>
          <input
            className="token-input"
            value={authInput}
            onChange={(e) => setAuthInput(e.target.value)}
            placeholder="Enter HERMES_WEB_TOKEN"
            type="password"
          />
          {authError ? <p className="auth-error">{authError}</p> : null}
          <button className="menu-item action" type="submit">Unlock</button>
        </form>
      </div>
    )
  }

  return (
    <div className={`layout ${mobileMenuOpen ? 'menu-open' : ''}`}>
      <header className="mobile-header">
        <div>
          <p className="mobile-eyebrow">Hermes</p>
          <strong>{sections.find((item) => item.key === active)?.label || 'Control Center'}</strong>
        </div>
        <button
          className="hamburger-button"
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="main-menu"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <aside className="sidebar">
        <div className="logo-block">
          <p className="logo-mark">HERMES</p>
          <p className="logo-mark">CONTROL</p>
        </div>

        <nav className="menu" id="main-menu">
          {sections.map((item) => (
            <button
              key={item.key}
              className={`menu-item ${active === item.key ? 'active' : ''}`}
              onClick={() => {
                setActive(item.key)
                setMobileMenuOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button className="menu-item" onClick={loadOverview}>Refresh Overview</button>
        <button className="menu-item" onClick={logout}>Lock / Forget Password</button>
      </aside>

      <main className="content">
        <header className="top-strip">
          <span>Hermes Web Control</span>
          <span>{loading ? 'Loading...' : 'Ready'}</span>
          <span>Authenticated</span>
          <span>{new Date().toLocaleTimeString()}</span>
        </header>

        {error ? <section className="error-box">{error}</section> : null}

        {active === 'dashboard' && (
          <section className="panel-grid">
            <h1>Command Center Overview</h1>
            <p className="lead">Live data from your Hermes CLI environment.</p>
            <div className="split-grid">
              <article className="panel">
                <h2>Status</h2>
                <pre>{truncate(statusPreview, 5000)}</pre>
              </article>
              <article className="panel">
                <h2>Profiles / Config Path</h2>
                <pre>{truncate(`${overview?.profiles?.stdout || ''}\n\n${overview?.configPath?.stdout || ''}`, 5000)}</pre>
              </article>
            </div>
          </section>
        )}

        {active === 'agents' && (
          <section className="panel-grid">
            <h1>Agents / Runtime Status</h1>
            <button className="menu-item action" onClick={loadOverview}>Reload</button>
            <article className="panel"><pre>{truncate(statusPreview, 12000)}</pre></article>
          </section>
        )}

        {active === 'kanban' && (
          <section className="panel-grid">
            <div className="section-heading-row">
              <div>
                <h1>Kanban Board</h1>
                <p className="lead">Create cards directly in a column and assign them to Hermes profiles/agents.</p>
              </div>
              <button className="menu-item action" onClick={loadKanban}>Load Board</button>
            </div>
            {kanbanActionMessage ? <section className="success-box">{kanbanActionMessage}</section> : null}
            <div className="kanban-columns">
              {kanbanStateOrder.map((state) => {
                const tasks: any[] = kanbanBoard?.tasksByState?.[state] || []
                const form = kanbanForms[state]
                return (
                  <article key={state} className="kanban-column">
                    <div className="kanban-column-header">
                      <h2>{titleCase(state)} ({tasks.length})</h2>
                    </div>

                    <div className="kanban-create-card">
                      <input
                        className="token-input compact"
                        value={form.title}
                        onChange={(e) => updateKanbanForm(state, { title: e.target.value })}
                        placeholder={`New ${titleCase(state)} task`}
                      />
                      <textarea
                        className="query-box compact"
                        value={form.body}
                        onChange={(e) => updateKanbanForm(state, { body: e.target.value })}
                        placeholder="Task details / acceptance criteria"
                      />
                      <div className="kanban-inline-fields">
                        <input
                          className="token-input compact"
                          value={form.priority}
                          onChange={(e) => updateKanbanForm(state, { priority: e.target.value })}
                          placeholder="Priority"
                          inputMode="numeric"
                        />
                        <select
                          className="token-input compact"
                          value={form.assignee}
                          onChange={(e) => updateKanbanForm(state, { assignee: e.target.value })}
                        >
                          <option value="">Unassigned</option>
                          {kanbanAssignees.map((assignee) => (
                            <option key={assignee.value} value={assignee.value}>{assignee.label} ({assignee.kind})</option>
                          ))}
                        </select>
                      </div>
                      <button className="menu-item action full-width" onClick={() => createKanbanTask(state)}>Create in {titleCase(state)}</button>
                    </div>

                    {tasks.length === 0 ? <p className="lead">No tasks</p> : null}
                    <div className="kanban-cards">
                      {tasks.map((task) => {
                        const taskId = String(task.id || '')
                        return (
                          <div className="kanban-card" key={task.id || `${state}-${task.title}`}>
                            <strong>{task.title || task.name || `Task ${task.id || ''}`}</strong>
                            <p>ID: {taskId || '-'}</p>
                            <p>Priority: {String(task.priority ?? '-')}</p>
                            <label className="token-label" htmlFor={`assignee-${taskId}`}>Agent / assignee</label>
                            <select
                              id={`assignee-${taskId}`}
                              className="token-input compact"
                              value={task.assignee || ''}
                              onChange={(e) => assignKanbanTask(taskId, e.target.value)}
                            >
                              <option value="">Unassigned</option>
                              <option value="none">None</option>
                              {kanbanAssignees.map((assignee) => (
                                <option key={assignee.value} value={assignee.value}>{assignee.label} ({assignee.kind})</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                )
              })}
            </div>
            <article className="panel"><h2>Raw Stats</h2><pre>{truncate(kanban?.stats?.stdout || '', 9000)}</pre></article>
          </section>
        )}

        {active === 'multi-agent' && (
          <section className="panel-grid">
            <h1>Multi Agent Management</h1>
            <p className="lead">Create agents, assign model/skills, and define operating rules/context.</p>

            <article className="panel">
              <h2>Create Agent</h2>
              <div className="form-grid">
                <input className="token-input" value={agentForm.name} onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))} placeholder="Agent name" />
                <input className="token-input" value={agentForm.model} onChange={(e) => setAgentForm((p) => ({ ...p, model: e.target.value }))} placeholder="Model (e.g. anthropic/claude-sonnet-4)" />
                <input className="token-input" value={agentForm.skills} onChange={(e) => setAgentForm((p) => ({ ...p, skills: e.target.value }))} placeholder="Skills (comma-separated)" />
                <textarea className="query-box" value={agentForm.rules} onChange={(e) => setAgentForm((p) => ({ ...p, rules: e.target.value }))} placeholder="Rules for this agent" />
                <textarea className="query-box" value={agentForm.context} onChange={(e) => setAgentForm((p) => ({ ...p, context: e.target.value }))} placeholder="Context / background for this agent" />
              </div>
              <button className="menu-item action" onClick={createMultiAgent}>Create Agent</button>
            </article>

            <button className="menu-item action" onClick={loadMultiAgents}>Reload Agent List</button>

            <div className="agents-grid">
              {agents.map((agent) => (
                <article className="panel" key={agent.id}>
                  <h2>{agent.name}</h2>
                  <div className="form-grid">
                    <input className="token-input" value={agent.name} onChange={(e) => setAgents((prev) => prev.map((x) => (x.id === agent.id ? { ...x, name: e.target.value } : x)))} />
                    <input className="token-input" value={agent.model || ''} onChange={(e) => setAgents((prev) => prev.map((x) => (x.id === agent.id ? { ...x, model: e.target.value } : x)))} placeholder="Model" />
                    <input className="token-input" value={(agent.skills || []).join(', ')} onChange={(e) => setAgents((prev) => prev.map((x) => (x.id === agent.id ? { ...x, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)))} placeholder="Skills comma separated" />
                    <textarea className="query-box" value={agent.rules || ''} onChange={(e) => setAgents((prev) => prev.map((x) => (x.id === agent.id ? { ...x, rules: e.target.value } : x)))} placeholder="Rules" />
                    <textarea className="query-box" value={agent.context || ''} onChange={(e) => setAgents((prev) => prev.map((x) => (x.id === agent.id ? { ...x, context: e.target.value } : x)))} placeholder="Context" />
                  </div>

                  <div className="actions-row">
                    <button className="menu-item action" onClick={() => updateMultiAgent(agent)}>Save</button>
                    <button className="menu-item" onClick={() => deleteMultiAgent(agent.id)}>Delete</button>
                  </div>

                  <h2>Run Agent</h2>
                  <input
                    className="token-input"
                    value={runPromptByAgent[agent.id] || ''}
                    onChange={(e) => setRunPromptByAgent((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                    placeholder="Prompt for this agent"
                  />
                  <button className="menu-item action" onClick={() => runMultiAgent(agent.id)}>Run Now</button>
                  <pre>{runOutputByAgent[agent.id] || ''}</pre>
                </article>
              ))}
            </div>
          </section>
        )}

        {active === 'collaboration' && (
          <section className="panel-grid collaboration-section">
            <div className="section-heading-row">
              <div>
                <h1>Agent Collaboration Layer</h1>
                <p className="lead">Structured handoffs between Pipo and Megan. Pipo consults Megan before financial-code work; sensitive actions can require approval.</p>
              </div>
              <button className="menu-item action" onClick={loadCollaboration}>Reload</button>
            </div>

            {collaborationMessage ? <section className="success-box">{collaborationMessage}</section> : null}

            <div className="split-grid">
              <article className="panel">
                <h2>Create Pipo → Megan Handoff</h2>
                <div className="form-grid">
                  <div className="collab-agent-row">
                    <select className="token-input" value={handoffForm.from} onChange={(e) => setHandoffForm((p) => ({ ...p, from: e.target.value }))}>
                      <option value="pipo">Pipo</option>
                      <option value="megan">Megan</option>
                    </select>
                    <span className="handoff-arrow">→</span>
                    <select className="token-input" value={handoffForm.to} onChange={(e) => setHandoffForm((p) => ({ ...p, to: e.target.value }))}>
                      <option value="megan">Megan</option>
                      <option value="pipo">Pipo</option>
                    </select>
                  </div>
                  <input className="token-input" value={handoffForm.type} onChange={(e) => setHandoffForm((p) => ({ ...p, type: e.target.value }))} placeholder="Type: consultation / financial_write / production_deploy" />
                  <input className="token-input" value={handoffForm.taskId} onChange={(e) => setHandoffForm((p) => ({ ...p, taskId: e.target.value }))} placeholder="Optional Kanban/task id" />
                  <textarea className="query-box" value={handoffForm.question} onChange={(e) => setHandoffForm((p) => ({ ...p, question: e.target.value }))} placeholder="Question / context for the other agent" />
                  <textarea className="query-box compact" value={handoffForm.requiredOutput} onChange={(e) => setHandoffForm((p) => ({ ...p, requiredOutput: e.target.value }))} placeholder="Required output" />
                </div>
                <button className="menu-item action" onClick={createHandoff}>Create Handoff</button>
              </article>

              <article className="panel">
                <h2>Directory / Guardrails</h2>
                <div className="directory-list">
                  {collaborationAgents.map((agent) => (
                    <div className="directory-card" key={agent.id}>
                      <strong>{agent.name || agent.id}</strong>
                      <p>{agent.role || 'Hermes agent'}</p>
                      <p>Can collaborate with: {(agent.canCollaborateWith || []).join(', ') || '-'}</p>
                    </div>
                  ))}
                </div>
                <p className="lead">Allowed MVP pair: Pipo ↔ Megan. Types <code>financial_write</code> and <code>production_deploy</code> start in waiting_approval.</p>
              </article>
            </div>

            <div className="collaboration-list">
              {collaborationTasks.length === 0 ? <article className="panel"><p className="lead">No collaboration tasks yet.</p></article> : null}
              {collaborationTasks.map((task) => (
                <article className="panel collaboration-card" key={task.id}>
                  <div className="collaboration-card-header">
                    <div>
                      <h2>{task.from} → {task.to} · {task.type}</h2>
                      <p className="lead">{task.id}{task.taskId ? ` · task ${task.taskId}` : ''}</p>
                    </div>
                    <span className={`status-pill ${task.status}`}>{task.status}{task.approvalRequired ? ' · approval' : ''}</span>
                  </div>
                  <p><strong>Required output:</strong> {task.requiredOutput}</p>
                  <div className="thread-list">
                    {(task.messages || []).map((message) => (
                      <div className="thread-message" key={message.id}>
                        <strong>{message.author}</strong>
                        <span>{new Date(message.createdAt).toLocaleString()}</span>
                        <p>{message.body}</p>
                      </div>
                    ))}
                  </div>
                  <textarea
                    className="query-box compact"
                    value={messageDrafts[task.id] || ''}
                    onChange={(e) => setMessageDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))}
                    placeholder={`Reply as ${task.to}`}
                  />
                  <div className="actions-row">
                    <button className="menu-item action" onClick={() => addCollaborationMessage(task)}>Add Reply</button>
                    <button className="menu-item" onClick={() => addCollaborationMessage(task, 'approved')}>Reply + Approve</button>
                    <button className="menu-item" onClick={() => addCollaborationMessage(task, 'blocked')}>Reply + Block</button>
                    <button className="menu-item" onClick={() => addCollaborationMessage(task, 'done')}>Reply + Done</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {active === 'finance' && (
          <section className="panel-grid finance-hero">
            <div>
              <h1>Raul — Personal Finance Agent</h1>
              <p className="lead">Specialized gpt-5.5 agent for Firefly III. Raul registers movements, analyzes data, summarizes your finances, and gives advice without building dashboards.</p>
            </div>

            <div className="split-grid">
              <article className="panel">
                <h2>Firefly Knowledge Source</h2>
                <p className="lead">Raul's knowledge comes from live Firefly III API data plus the OpenClaw operating rules imported into the <code>firefly-finance-agent</code> skill.</p>
                <div className="actions-row finance-actions">
                  <button className="menu-item action" onClick={loadFinanceStatus}>Check Firefly Connection</button>
                  <button className="menu-item" onClick={bootstrapFinanceAgent}>Create / Update Agent Card</button>
                </div>
                <pre>{financeStatus ? truncate(JSON.stringify(financeStatus, null, 2), 9000) : 'Not checked yet. Click “Check Firefly Connection”.'}</pre>
              </article>

              <article className="panel">
                <h2>Ask / Register Movement</h2>
                <textarea className="query-box finance-query" value={financePrompt} onChange={(e) => setFinancePrompt(e.target.value)} placeholder="Example: Raul, gasto de 25.000, almuerzos" />
                <button className="menu-item action" onClick={runFinanceAgent}>Run Finance Agent</button>
                <pre>{financeOutput || 'The response will appear here. For writes, the agent must infer safely or ask one concrete question.'}</pre>
              </article>
            </div>
          </section>
        )}

        {active === 'models' && (
          <section className="panel-grid">
            <h1>Models / Tools</h1>
            <button className="menu-item action" onClick={loadOverview}>Reload</button>
            <div className="split-grid">
              <article className="panel"><h2>Tools</h2><pre>{truncate(toolsPreview, 10000)}</pre></article>
              <article className="panel"><h2>Config Path</h2><pre>{truncate(overview?.configPath?.stdout || '', 10000)}</pre></article>
            </div>
          </section>
        )}

        {active === 'skills' && (
          <section className="panel-grid">
            <h1>Skills</h1>
            <button className="menu-item action" onClick={loadOverview}>Reload</button>
            <article className="panel"><pre>{truncate(skillsPreview, 12000)}</pre></article>
          </section>
        )}

        {active === 'cron' && (
          <section className="panel-grid">
            <h1>Cron Jobs</h1>
            <button className="menu-item action" onClick={loadCron}>Load Cron</button>
            <article className="panel"><pre>{truncate(cron?.jobs?.stdout || '', 12000)}</pre></article>
          </section>
        )}

        {active === 'sessions' && (
          <section className="panel-grid">
            <h1>Sessions</h1>
            <button className="menu-item action" onClick={loadSessions}>Load Sessions</button>
            <article className="panel"><pre>{truncate(sessions?.sessions?.stdout || '', 12000)}</pre></article>
          </section>
        )}

        {active === 'command' && (
          <section className="panel-grid">
            <h1>Safe Command Runner</h1>
            <p className="lead">Allowed commands: status/tools/skills/cron/kanban/profile/sessions/doctor/gateway/config/model</p>
            <input className="token-input" value={commandArgs} onChange={(e) => setCommandArgs(e.target.value)} placeholder="status --all" type="text" />
            <button className="menu-item action" onClick={runCommand}>Run Command</button>
            <article className="panel"><pre>{commandOutput}</pre></article>
          </section>
        )}

        {active === 'chat' && (
          <section className="panel-grid">
            <h1>Control Hermes via Chat</h1>
            <textarea className="query-box" value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} placeholder="Ask Hermes to do something" />
            <div className="split-grid small">
              <input className="token-input" value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="Optional model" type="text" />
              <input className="token-input" value={chatProvider} onChange={(e) => setChatProvider(e.target.value)} placeholder="Optional provider" type="text" />
            </div>
            <button className="menu-item action" onClick={runChat}>Send to Hermes</button>
            <article className="panel"><pre>{chatOutput}</pre></article>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
