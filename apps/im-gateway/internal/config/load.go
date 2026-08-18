package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// loadConfig is the real implementation behind LoadConfig. Reads YAML from
// path, applies defaults, then overlays environment variables. Returns a
// Config that is safe to use even if many fields were left empty.
//
// Returns an error only on hard failures: file unreadable (other than ENOENT,
// which is treated as "use defaults"), malformed YAML, invalid enum values.
func loadConfig(path string) (*Config, error) {
	cfg := &Config{}

	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("read config %s: %w", path, err)
		}
		if err == nil {
			if err := yaml.Unmarshal(raw, cfg); err != nil {
				return nil, fmt.Errorf("parse config %s: %w", path, err)
			}
		}
	}

	applyEnvOverrides(cfg)

	if err := applyDefaults(cfg); err != nil {
		return nil, err
	}
	if err := validate(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// applyEnvOverrides reads environment variables that override config fields.
// Only the most useful overrides are exposed; full coverage would be noisy
// and most fields are simpler to edit in YAML.
func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("IM_GATEWAY_TRANSPORT"); v != "" {
		cfg.Transport.Name = TransportName(v)
	}
	if v := os.Getenv("IM_GATEWAY_LOG_LEVEL"); v != "" {
		cfg.Logging.Level = v
	}
	if v := os.Getenv("IM_GATEWAY_LOG_FILE"); v != "" {
		cfg.Logging.File = v
	}
	if v := os.Getenv("IM_GATEWAY_CONVERSATION_CWD"); v != "" {
		cfg.Paths.ConversationCwd = v
	}
	if v := os.Getenv("IM_GATEWAY_STATE"); v != "" {
		cfg.Paths.State = v
	}
	if v := os.Getenv("IM_GATEWAY_LOGS_DIR"); v != "" {
		cfg.Paths.LogsDir = v
	}
	if v := os.Getenv("IM_GATEWAY_CODING_AGENT_BIN"); v != "" {
		cfg.HostClient.CodingAgentBin = v
	}
}

// applyDefaults fills in any zero-valued fields with sensible defaults
// derived from $HOME/.vetta. Idempotent: calling it twice yields the same
// Config.
func applyDefaults(cfg *Config) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home dir: %w", err)
	}

	if cfg.Transport.Name == "" {
		cfg.Transport.Name = TransportMock
	}

	if cfg.HostClient.PoolMaxSize == 0 {
		cfg.HostClient.PoolMaxSize = DefaultPoolMaxSize
	}
	if cfg.HostClient.HandshakeTimeout == 0 {
		cfg.HostClient.HandshakeTimeout = DefaultHandshakeTimeout
	}
	if cfg.HostClient.CloseTimeout == 0 {
		cfg.HostClient.CloseTimeout = DefaultCloseTimeout
	}

	if cfg.Logging.Level == "" {
		cfg.Logging.Level = "info"
	}

	vettaDir := filepath.Join(home, ".vetta")
	gatewayDir := filepath.Join(vettaDir, "im-gateway")
	if cfg.Paths.ConversationCwd == "" {
		cfg.Paths.ConversationCwd = filepath.Join(gatewayDir, "conversation")
	}
	if cfg.Paths.State == "" {
		cfg.Paths.State = filepath.Join(gatewayDir, "state.json")
	}
	if cfg.Paths.LogsDir == "" {
		cfg.Paths.LogsDir = filepath.Join(gatewayDir, "logs")
	}
	if cfg.Paths.WechatState == "" {
		cfg.Paths.WechatState = filepath.Join(gatewayDir, "wechat.json")
	}
	cfg.Paths.ConversationCwd = expandTilde(cfg.Paths.ConversationCwd, home)
	cfg.Paths.State = expandTilde(cfg.Paths.State, home)
	cfg.Paths.LogsDir = expandTilde(cfg.Paths.LogsDir, home)
	cfg.Paths.WechatState = expandTilde(cfg.Paths.WechatState, home)
	return nil
}

func expandTilde(p, home string) string {
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return p
}

// validate checks that required fields are filled and enum values are
// recognized. Returns a descriptive error pointing the user at the
// offending field.
func validate(cfg *Config) error {
	switch cfg.Transport.Name {
	case TransportMock, TransportFeishu, TransportWechat:
		// ok
	default:
		return fmt.Errorf("config: transport.name must be one of [mock, feishu, wechat], got %q", cfg.Transport.Name)
	}
	if cfg.HostClient.PoolMaxSize < 1 {
		return fmt.Errorf("config: hostClient.poolMaxSize must be >= 1, got %d", cfg.HostClient.PoolMaxSize)
	}
	switch cfg.Logging.Level {
	case "debug", "info", "warn", "error":
		// ok
	default:
		return fmt.Errorf("config: logging.level must be one of [debug, info, warn, error], got %q", cfg.Logging.Level)
	}
	return nil
}

