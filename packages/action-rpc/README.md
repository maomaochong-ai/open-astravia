# @vetta/action-rpc

Localhost HTTP JSON RPC transport for Vetta Desktop capabilities.

This package owns transport, protocol, server, and client helpers only. It does
not define desktop business capabilities.

The server supports independently registered namespaces on one authenticated
endpoint:

- `actions.*` for regular app actions.
- `debug.*` for development-only debug capabilities.

`startActionRpcServer()` remains as the action-only compatibility wrapper.
