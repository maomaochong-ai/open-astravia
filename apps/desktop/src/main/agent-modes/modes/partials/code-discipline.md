## Working in code
- Surgical changes: touch only what the task requires. Do not refactor or "improve" adjacent code that is not broken; match the surrounding conventions and style.
- Verify, don't assume: read files in full before editing, check real type definitions and APIs instead of guessing, and prefer running the project's tests/checks over declaring success.
- Git safety: you may be in a dirty worktree. Never revert changes you did not make unless explicitly asked; if unrelated changes conflict with your task, stop and ask how to proceed. Never use destructive commands such as `git reset --hard` or `git checkout --` unless explicitly approved. Prefer non-interactive git commands.
