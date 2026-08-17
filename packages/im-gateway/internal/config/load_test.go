package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadConfig_NoFile_AppliesDefaults(t *testing.T) {
	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig empty: %v", err)
	}
	if cfg.Transport.Name != TransportMock {
		t.Errorf("default transport: want mock, got %q", cfg.Transport.Name)
	}
	if cfg.HostClient.PoolMaxSize != DefaultPoolMaxSize {
		t.Errorf("default pool size: want %d, got %d", DefaultPoolMaxSize, cfg.HostClient.PoolMaxSize)
	}
	if cfg.HostClient.HandshakeTimeout != DefaultHandshakeTimeout {
		t.Errorf("default handshake timeout: want %v, got %v", DefaultHandshakeTimeout, cfg.HostClient.HandshakeTimeout)
	}
	if cfg.Logging.Level != "info" {
		t.Errorf("default log level: want info, got %q", cfg.Logging.Level)
	}
	if cfg.Paths.ConversationCwd == "" {
		t.Error("ConversationCwd path not defaulted")
	}
	if !strings.HasSuffix(cfg.Paths.ConversationCwd, filepath.Join("im-gateway", "conversation")) {
		t.Errorf("ConversationCwd path looks wrong: %s", cfg.Paths.ConversationCwd)
	}
}

func TestLoadConfig_MissingFile_NotAnError(t *testing.T) {
	cfg, err := LoadConfig("/nonexistent/path/to/config.yaml")
	if err != nil {
		t.Fatalf("missing file should not error: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil cfg even when file missing")
	}
}

func TestLoadConfig_ValidYAML(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	contents := `transport:
  name: feishu
  feishu:
    baseUrl: https://example.invalid
hostClient:
  poolMaxSize: 16
  handshakeTimeout: 45s
logging:
  level: debug
paths:
  state: /tmp/im-gateway-state.json
`
	if err := os.WriteFile(cfgPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.Transport.Name != TransportFeishu {
		t.Errorf("transport name: want feishu, got %q", cfg.Transport.Name)
	}
	if cfg.Transport.Feishu == nil || cfg.Transport.Feishu.BaseURL != "https://example.invalid" {
		t.Errorf("feishu baseUrl not parsed: %+v", cfg.Transport.Feishu)
	}
	if cfg.HostClient.PoolMaxSize != 16 {
		t.Errorf("pool size: want 16, got %d", cfg.HostClient.PoolMaxSize)
	}
	if cfg.HostClient.HandshakeTimeout != 45*time.Second {
		t.Errorf("handshake timeout: want 45s, got %v", cfg.HostClient.HandshakeTimeout)
	}
	if cfg.Logging.Level != "debug" {
		t.Errorf("log level: want debug, got %q", cfg.Logging.Level)
	}
	if cfg.Paths.State != "/tmp/im-gateway-state.json" {
		t.Errorf("state path: %q", cfg.Paths.State)
	}
}

func TestLoadConfig_InvalidTransportName(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	contents := `transport:
  name: aol-instant-messenger
`
	if err := os.WriteFile(cfgPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfig(cfgPath)
	if err == nil {
		t.Fatal("expected error for invalid transport name")
	}
	if !strings.Contains(err.Error(), "transport.name") {
		t.Errorf("error message should mention transport.name, got: %v", err)
	}
}

func TestLoadConfig_InvalidLogLevel(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	contents := `logging:
  level: SHOUTY_CAPS
`
	if err := os.WriteFile(cfgPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfig(cfgPath)
	if err == nil {
		t.Fatal("expected error for invalid log level")
	}
}

func TestLoadConfig_MalformedYAML(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	if err := os.WriteFile(cfgPath, []byte("transport: { unclosed"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadConfig(cfgPath)
	if err == nil {
		t.Fatal("expected parse error")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("error should mention parse, got: %v", err)
	}
}

func TestLoadConfig_EnvOverridesYAML(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	contents := `transport:
  name: mock
logging:
  level: warn
`
	if err := os.WriteFile(cfgPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("IM_GATEWAY_TRANSPORT", "feishu")
	t.Setenv("IM_GATEWAY_LOG_LEVEL", "debug")

	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Transport.Name != TransportFeishu {
		t.Errorf("env should override transport: want feishu, got %q", cfg.Transport.Name)
	}
	if cfg.Logging.Level != "debug" {
		t.Errorf("env should override log level: want debug, got %q", cfg.Logging.Level)
	}
}

func TestLoadConfig_TildeExpansion(t *testing.T) {
	tempDir := t.TempDir()
	cfgPath := filepath.Join(tempDir, "config.yaml")
	contents := `paths:
  state: ~/custom/state.json
`
	if err := os.WriteFile(cfgPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, "custom/state.json")
	if cfg.Paths.State != want {
		t.Errorf("tilde not expanded: want %q, got %q", want, cfg.Paths.State)
	}
}
