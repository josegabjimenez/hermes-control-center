function addUnique(options, seen, option) {
  if (!option?.value || !option?.label || option.value === 'none' || seen.has(option.value)) return
  seen.add(option.value)
  options.push(option)
}

export function normalizeKanbanAssigneeOptions(cliAssignees = [], agents = []) {
  const options = []
  const seen = new Set()

  if (Array.isArray(cliAssignees)) {
    for (const item of cliAssignees) {
      const value = typeof item === 'string' ? item : item?.profile || item?.assignee || item?.name
      const trimmed = typeof value === 'string' ? value.trim() : ''
      addUnique(options, seen, { value: trimmed, label: trimmed, kind: 'profile' })
    }
  }

  if (Array.isArray(agents)) {
    for (const agent of agents) {
      const value = typeof agent?.id === 'string' ? agent.id.trim() : ''
      const label = typeof agent?.name === 'string' ? agent.name.trim() : ''
      addUnique(options, seen, { value, label, kind: 'agent' })
    }
  }

  return options
}
