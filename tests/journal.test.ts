import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const CWD = 'C:\\proj'
const DIR = 'C:\\proj\\.claude\\session-journal'
const NOTE_TOOL = 'mcp__session-journal__note'

/** The world beneath the mod: a file system in memory and the session's own answers. */
function world(on: On, options: { askAnswer?: string; store?: Record<string, unknown> } = {}) {
  const files: Record<string, string> = {}
  const asked: string[] = []
  const ran: string[] = []
  mock.clock(on, { now: Date.UTC(2026, 10, 11, 12, 0, 0) })
  mock.store(on, options.store ?? {})
  const rows = mock.session(on)

  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.list', (_, e) => ({
    value: Object.keys(files)
      .filter(p => p.startsWith(`${e.path}\\`))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.repo', () => ({ value: null }))
  on('session.version', () => ({ value: { version: '9.9.9', base: '9.9.9', builtAt: '' } }))
  on('session.messages', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'journal' } }))
  on('tool.register', () => ({ value: { tool: NOTE_TOOL } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.fill', () => ({ value: { text: '', cursor: 0 } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('tool.call', (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const questions = (e as unknown as { questions: Array<{ question: string }> }).questions
      asked.push(questions[0]?.question ?? '')
      if (options.askAnswer === undefined) return { deny: 'dismissed' }
      return { result: { questions, answers: { [questions[0]?.question ?? '']: options.askAnswer } } }
    }
    ran.push(String(e.tool))
    return { result: {} }
  })

  const journal = () => {
    const name = Object.keys(files).find(p => p.startsWith(DIR) && p.endsWith('.md'))
    return name === undefined ? undefined : files[name]
  }
  return { files, asked, ran, rows, journal }
}

const prompt = (text: string, uuid: string) =>
  ({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  }) as const

test('the journal is off by default and writes nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.session.append(prompt('hello', 'u1') as never)
  expect(w.journal()).toBeUndefined()
})

test('/journal on records prompts, tool calls and results, and tells Claude', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const { text } = await $.command.run({ command: 'journal', args: 'on' } as never)
  expect(text).toContain('Session journal on')
  expect(w.files[`${DIR}\\.gitignore`]).toContain('*')

  await $.session.append(prompt('fix the parser', 'u2') as never)
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid: 'a1',
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking at it.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'go test ./...' } },
      ],
    },
  } as never)
  await $.session.append({
    door: 'tool-result',
    origin: { kind: 'tool', tool: 'Bash' },
    uuid: 'r1',
    message: {
      type: 'user',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok  parser  0.2s' }],
    },
  } as never)

  const md = w.journal() ?? ''
  expect(md).toContain('# Session journal')
  expect(md).toContain('claude --resume sess-1')
  expect(md).toContain('fix the parser')
  expect(md).toContain('Tool call: Bash')
  expect(md).toContain('go test ./...')
  expect(md).toContain('ok  parser  0.2s')
  expect(w.rows.appended().some(r => JSON.stringify(r).includes('[session-journal]'))).toBe(true)
})

test('Claude may add notes; an edit that only inserts goes through', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'journal', args: 'on' } as never)

  const note = await $.tool.call({ tool: NOTE_TOOL, text: 'Decided to keep the v1 API.', heading: 'Decision' } as never)
  expect(String(note.result)).toContain('Added to')
  expect(w.journal()).toContain('Note from Claude: Decision')

  const path = Object.keys(w.files).find(p => p.endsWith('.md')) ?? ''
  const edit = await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'Decided', new_string: 'Decided (after review)' } as never)
  expect(edit.deny).toBeUndefined()
  expect(w.asked).toHaveLength(0)
  expect(w.ran).toContain('Edit')
})

test('deleting or rewriting journal text is held until the person allows it', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'journal', args: 'on' } as never)
  const path = Object.keys(w.files).find(p => p.endsWith('.md')) ?? ''

  const edit = await $.tool.call({ tool: 'Edit', file_path: path, old_string: '# Session journal', new_string: '' } as never)
  expect(edit.deny).toContain('append-only')

  const write = await $.tool.call({ tool: 'Write', file_path: path, content: 'gone' } as never)
  expect(write.deny).toContain('append-only')

  const rm = await $.tool.call({ tool: 'Bash', command: `rm -rf "${DIR}"` } as never)
  expect(rm.deny).toContain('append-only')

  const ps = await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item .claude -Recurse' } as never)
  expect(ps.deny).toContain('append-only')

  expect(w.asked).toHaveLength(4)
  expect(w.ran).not.toContain('Edit')

  // Commands that do not touch the journal are not held.
  const other = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
  expect(other.deny).toBeUndefined()
  // Even with the journal off, old journals stay protected.
  await $.command.run({ command: 'journal', args: 'off' } as never)
  const later = await $.tool.call({ tool: 'Bash', command: `del "${path}"` } as never)
  expect(later.deny).toContain('append-only')
})

test('the person can allow one change', async ($, on) => {
  const w = world(on, { askAnswer: 'Allow once' })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'journal', args: 'on' } as never)
  const ran = await $.tool.call({ tool: 'Bash', command: `rm "${DIR}\\old.md"` } as never)
  expect(ran.deny).toBeUndefined()
  expect(w.asked).toHaveLength(1)
  expect(w.ran).toContain('Bash')
})

test('with no dialog, /journal allow permits exactly one change', async ($, on) => {
  const w = world(on) // the dialog is dismissed: no answer comes back
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'journal', args: 'on' } as never)

  const refused = await $.tool.call({ tool: 'Bash', command: `rm "${DIR}\\old.md"` } as never)
  expect(refused.deny).toContain('/journal allow')

  await $.command.run({ command: 'journal', args: 'allow', origin: { kind: 'composer' } } as never)
  const first = await $.tool.call({ tool: 'Bash', command: `rm "${DIR}\\old.md"` } as never)
  expect(first.deny).toBeUndefined()
  const second = await $.tool.call({ tool: 'Bash', command: `rm "${DIR}\\other.md"` } as never)
  expect(second.deny).toContain('append-only')
  expect(w.ran.filter(t => t === 'Bash')).toHaveLength(1)
})

test('auto-start turns it on in a new session', async ($, on) => {
  const w = world(on, { store: { autoStart: true } })
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  await $.session.append(prompt('first prompt', 'u3') as never)
  expect(w.journal()).toContain('first prompt')
})
