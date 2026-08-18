// Package transport defines the platform-agnostic IM messaging interface.
//
// # Boundary rules
//
// This package and its subpackages (transport/feishu, transport/mock, ...)
// are the ONLY place in the gateway where platform SDK types may appear.
// Upper layers (router, command, bridge) MUST NOT import any IM platform
// SDK directly. The way to add new platform features is:
//
//  1. Add a Capability flag here in types.go if needed
//  2. Implement the new behavior in transport/<platform>/
//  3. Have the bridge consult Capabilities() and pick a code path
//
// Validation: `grep -r 'oapi-sdk-go\|telegram-bot-api' internal/{router,bridge,command}`
// must return zero matches. The CI lint script enforces this.
package transport
