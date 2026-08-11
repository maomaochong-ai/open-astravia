# @vetta/runtime-knowledge

Runtime-owned Knowledge capability for Agent hosts.

## What It Owns

- wiki frontmatter and derived index domain rules
- raw-file scanning, atomic file persistence and deterministic layout
- tag queries and concurrent-safe page writes
- processing diff, batching, quarantine and round finalization

## What It Does Not Own

- Agent Session or model execution
- Tool schemas and model-visible descriptions
- Desktop UI, polling schedules or the default Vetta home directory

Hosts must pass the Knowledge root explicitly. Product composition currently resolves the existing
`~/.vetta/knowledges` location before calling this package.
