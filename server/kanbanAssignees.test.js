import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeKanbanAssigneeOptions } from './kanbanAssignees.js'

test('combines Hermes profile assignees with Control Center agents', () => {
  const options = normalizeKanbanAssigneeOptions(
    [
      { name: 'default', on_disk: true },
      { profile: 'pipo' },
      'none',
    ],
    [
      { id: 'agent_pipo_code', name: 'Pipo — Code Agent' },
      { id: 'agent_horacio_creative', name: 'Horacio — Creative Agent' },
    ],
  )

  assert.deepEqual(options, [
    { value: 'default', label: 'default', kind: 'profile' },
    { value: 'pipo', label: 'pipo', kind: 'profile' },
    { value: 'agent_pipo_code', label: 'Pipo — Code Agent', kind: 'agent' },
    { value: 'agent_horacio_creative', label: 'Horacio — Creative Agent', kind: 'agent' },
  ])
})

test('deduplicates by value and skips invalid/none entries', () => {
  const options = normalizeKanbanAssigneeOptions(
    [{ name: 'default' }, { name: 'none' }, { name: '' }, null],
    [{ id: 'default', name: 'Duplicate Default Agent' }, { id: '', name: 'Missing ID' }, { id: 'agent_valid', name: '' }],
  )

  assert.deepEqual(options, [
    { value: 'default', label: 'default', kind: 'profile' },
  ])
})
