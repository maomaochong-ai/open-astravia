# @vetta/runtime-storage

Runtime-owned conversation storage implementations for Agent hosts.

The package root and `@vetta/runtime-storage/conversation` expose the same native
conversation persistence surface. Auth and product settings remain host-owned
and are not exported by this package.

## What It Owns

- versioned file Conversation Repository
- strict native Conversation V1/V2 reading and V2 document-entry envelopes
- read-only Legacy v1-v3 Session JSONL import into the Runtime Conversation Document
- TypeBox runtime validation for persisted conversation records
- stable absolute conversation path resolution for runtime session identity

## What It Does Not Own

- host-specific file selection or path permissions
- application UI
- business data models

## Who Depends On It

- runtime hosts and embedded apps that need storage without importing deep `coding-agent` internals

## Main Exports

- `FileConversationRepository` and stable storage errors from the package root
  or `@vetta/runtime-storage/conversation`
- `FileConversationRepository.resolveConversationPath()` for composition-owned identity metadata
- `FileConversationRepository.readDocument()` and `LegacySessionDocumentReader` for native and Legacy history reads
