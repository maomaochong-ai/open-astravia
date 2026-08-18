// Package logger wraps go.uber.org/zap to give the gateway a single
// configured *zap.Logger and a small set of conventions.
//
// # Boundary rules
//
//   - All logging in the gateway goes through the logger constructed here
//     so log destinations (stderr / file), levels, and field conventions
//     stay consistent.
//   - Never log secret values (Feishu app secret, OAuth tokens, etc.).
//     Log the *source* of credentials (e.g. "from keychain") rather than
//     the values themselves.
//   - Per-request fields (user_id, project_id, session_path) MUST go into
//     structured zap fields so log queries can filter by them.
package logger
