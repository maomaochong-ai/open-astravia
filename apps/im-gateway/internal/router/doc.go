// Package router maps inbound IM messages to the right agent session.
//
// # Boundary rules
//
//   - This package MUST NOT import any IM platform SDK.
//   - This package MUST NOT spawn subprocesses or talk to coding-agent
//     directly; it goes through the hostclient interface.
//   - The (im_user, project) → session mapping is the router's
//     responsibility. Project resolution is delegated to projects.
//     ProjectDirectory; persistence is delegated to state.Store.
//
// The router runs one goroutine per (user, project) pair so messages from
// the same conversation are processed in order without holding a global
// mutex.
package router
