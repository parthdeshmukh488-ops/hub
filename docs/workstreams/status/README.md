# Workstream status files

Each workstream edits **only its own** file here. These files are how parallel sessions (and Parth) see where everything stands without reading every branch.

Update your file at the end of every work block. Keep it short and current: replace old content rather than appending a diary.

## Template

```markdown
# WS<N> status: <name>

- Session branch: <branch name>
- Last updated: YYYY-MM-DD
- Current build step: <number and name from the brief>

## Done
- <what exists now, with the command or test that shows it>

## Next
- <the next concrete step>

## Open items
- <TODOs referenced from code, known gaps>

## Questions for other workstreams
- WS<M>: <question>

## Contract changes proposed
- <link to ADR, or "none">
```
