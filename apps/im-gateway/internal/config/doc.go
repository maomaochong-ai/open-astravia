// Package config loads gateway configuration and credentials.
//
// # Boundary rules
//
//   - Non-secret config (transport selection, paths, log level, pool size)
//     comes from ~/.vetta/im-gateway/config.yaml.
//   - Secrets (Feishu app secret, etc.) come from a separate loader chain:
//     OS keychain → ~/.vetta/im-gateway/credentials.yaml (chmod 0600) →
//     environment variables. Each successful source is recorded in
//     Credentials.Source for audit logging.
//   - This package MUST NOT log secret values. Source provenance is fine;
//     the values themselves are not.
//   - This package owns the merging order; callers MUST NOT reach into the
//     individual sources directly.
//
// Defaults (DefaultPoolMaxSize, DefaultHandshakeTimeout, etc.) live in
// types.go and are applied during LoadConfig.
package config
