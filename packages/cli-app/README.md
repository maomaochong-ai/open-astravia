# @vetta/cli-app

CLI and process composition roots around `@vetta/coding-agent`.

## What It Owns

- process entrypoint for the CLI app
- the `vetta`, `vetta-agent`, and `vetta-agent-rpc` executable entrypoints
- host-profile selection for Print, RPC, and IM RPC execution
- dedicated JSONL RPC sidecar entrypoint
- argument handoff into `coding-agent`

## Runtime Entry

All Agent commands use the single production runtime. IM capabilities are enabled by the host profile rather than a runtime selector:

```text
vetta-agent-rpc --mode rpc \
  --enable-host-bridge \
  --scenario im-claw \
  --session-dir <conversation-directory>
```

The dedicated RPC entry keeps stdout reserved for JSONL protocol frames; startup diagnostics use stderr. Historical
session files remain readable through the explicit pre-open import boundary, but they do not select a different runtime.

## What It Does Not Own

- agent behavior
- model/provider logic
- terminal UI primitives

## Who Depends On It

- shell users and packaging targets that want a dedicated CLI package
