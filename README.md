# session-journal

A Claude Code mod that writes the running session to an append-only Markdown
journal, so the work can be recovered after a crash, a lost session or a
compaction that dropped something. Off by default.

## Use

| Command | What it does |
|---|---|
| `/journal on` | Start the journal for this session (earlier messages are backfilled) |
| `/journal off` | Stop it; the file stays |
| `/journal status` | Whether it is on, where it writes, and this help |
| `/journal auto on` / `off` | Start it in every new session (default off) |
| `/journal note <text>` | Add your own note |
| `/journal list` | The most recent journals |
| `/journal resume [path]` | Fill the prompt with a request for Claude to recover from a journal (the newest earlier one if no path) |
| `/journal allow` | Allow Claude one change that removes or rewrites journal text, within 5 minutes |

Journals go to `<project>/.claude/session-journal/<date>_<session id>.md`, with
a `.gitignore` there so they are not committed. Past about 3 MB a file rolls
over to `.part2.md`, `.part3.md`, ...

## What it records

Every prompt, every reply, every tool call with its input, every tool result
(clipped to 4,000 characters), messages delivered from other sessions, slash
commands, compactions with their summary, turn ends, `/clear` and session end,
plus a header with the session id, the `claude --resume` line, the raw
transcript's likely path, the working directory, git and model. Each entry is
written to disk as it happens.

## The append-only rule

Claude may add to a journal: with the `mcp__session-journal__note` tool
(append, or insert after a given passage), or with an Edit/Write that only adds
text. A call that would remove or rewrite journal text, or delete, move or
overwrite a journal file (Edit, Write, Bash, PowerShell), stops and asks you
first: **Deny** or **Allow once**. Where no dialog can be shown (as in the
desktop app), the call is refused, and you can permit one such change by
typing `/journal allow`: it lasts 5 minutes and is used up by the first change.
Only you can run it. This covers old journals too, even while the journal is
off. The shell check is best effort: it matches commands that name the journal
folder or `.claude` itself, so something like deleting the whole project
folder is not caught.

## Install

At the prompt of a terminal session:

```
/plugin install session-journal --marketplace TheOmnilord/claude-session-journal
```

Answer `y` to add the marketplace, then pick a scope (user is the default).

From a shell:

```
claude plugin install session-journal --marketplace TheOmnilord/claude-session-journal
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `TheOmnilord/claude-session-journal`,
then Add plugin.
