package config

import "time"

// Config is the parsed gateway configuration. Loaded from YAML, then
// overlaid with environment variables. Credentials are loaded separately
// (see Credentials below) so secret values never need to live alongside
// non-secret config in the same file.
type Config struct {
	Transport  TransportConfig  `yaml:"transport"`
	HostClient HostClientConfig `yaml:"hostClient"`
	Logging    LoggingConfig    `yaml:"logging"`
	Paths      PathsConfig      `yaml:"paths"`
}

// TransportConfig selects which IM transport to run and carries its
// platform-specific options. Exactly one of the per-platform sub-configs is
// honored based on Name.
type TransportConfig struct {
	Name     TransportName   `yaml:"name"`
	Feishu   *FeishuConfig   `yaml:"feishu,omitempty"`
	Mock     *MockConfig     `yaml:"mock,omitempty"`
	Wechat   *WechatConfig   `yaml:"wechat,omitempty"`
	Telegram *TelegramConfig `yaml:"telegram,omitempty"`
	Slack    *SlackConfig    `yaml:"slack,omitempty"`
	Discord  *DiscordConfig  `yaml:"discord,omitempty"`
	Signal   *SignalConfig   `yaml:"signal,omitempty"`
	Whatsapp *WhatsappConfig `yaml:"whatsapp,omitempty"`
	IMessage *IMessageConfig `yaml:"imessage,omitempty"`
}

type TransportName string

const (
	TransportFeishu   TransportName = "feishu"
	TransportMock     TransportName = "mock"
	TransportWechat   TransportName = "wechat"
	TransportTelegram TransportName = "telegram"
	TransportSlack    TransportName = "slack"
	TransportDiscord  TransportName = "discord"
	TransportSignal   TransportName = "signal"
	TransportWhatsapp TransportName = "whatsapp"
	TransportIMessage TransportName = "imessage"
)

// TransportNames lists every recognized transport.name value, in the order
// shown in error messages and the config template.
var TransportNames = []TransportName{
	TransportMock, TransportFeishu, TransportWechat, TransportTelegram,
	TransportSlack, TransportDiscord, TransportSignal, TransportWhatsapp,
	TransportIMessage,
}

// FeishuConfig holds the non-secret part of feishu transport configuration.
// Secrets (AppSecret) live in Credentials.
type FeishuConfig struct {
	BaseURL string `yaml:"baseUrl,omitempty"` // optional override; defaults to open.feishu.cn
}

// MockConfig is empty for now; the mock transport reads from stdin and
// writes to stdout regardless of config. Reserved for future flags like
// "delay every reply by N ms".
type MockConfig struct{}

// WechatConfig holds the non-secret part of the wechat (iLink) transport
// configuration. Credentials are NOT in this struct — they live in the
// runtime state file (cfg.Paths.WechatState) populated by `im-gateway
// wechat login`. There is no static API key for iLink.
type WechatConfig struct {
	// QuotaPerWindow caps successful sends per peer per QuotaWindow.
	// Defaults to 10 (mirroring the upstream server-side ceiling).
	QuotaPerWindow int `yaml:"quotaPerWindow,omitempty"`

	// QuotaWindow is the rolling window length for QuotaPerWindow.
	// Defaults to 24h.
	QuotaWindow time.Duration `yaml:"quotaWindow,omitempty"`
}

// TelegramConfig holds the non-secret part of telegram transport
// configuration. The bot token lives in Credentials.
type TelegramConfig struct {
	AllowedUserIDs []int64 `yaml:"allowedUserIds,omitempty"` // empty = accept all DMs
}

// SlackConfig holds the non-secret part of slack transport configuration.
// Tokens live in Credentials.
type SlackConfig struct {
	AllowedUserIDs    []string `yaml:"allowedUserIds,omitempty"`
	AllowedChannelIDs []string `yaml:"allowedChannelIds,omitempty"` // channel IDs, not names
}

// DiscordConfig holds the non-secret part of discord transport
// configuration. The bot token lives in Credentials.
type DiscordConfig struct {
	AllowedUserIDs  []string `yaml:"allowedUserIds,omitempty"`
	AllowedGuildIDs []string `yaml:"allowedGuildIds,omitempty"`
}

// SignalConfig configures the signal transport. Nothing here is secret —
// signal-cli owns the Signal credentials.
//
// Leaving endpoint empty (the default) puts the gateway in managed mode: it
// locates the signal-cli you installed, discovers the linked account, and
// runs `signal-cli daemon --http` on a loopback port for the process
// lifetime. Set endpoint to point at a daemon you run yourself instead.
type SignalConfig struct {
	Endpoint       string   `yaml:"endpoint,omitempty"`  // set = talk to your own daemon; empty = gateway runs signal-cli
	Account        string   `yaml:"account,omitempty"`   // E.164 number; discovered from signal-cli when empty
	CLIPath        string   `yaml:"cliPath,omitempty"`   // explicit signal-cli executable; empty = search PATH + package-manager locations
	ConfigDir      string   `yaml:"configDir,omitempty"` // signal-cli --config; empty = signal-cli default
	ProxyURL       string   `yaml:"proxyUrl,omitempty"`  // proxy for signal-cli; empty = HTTPS_PROXY/HTTP_PROXY, then the OS proxy settings
	AllowedNumbers []string `yaml:"allowedNumbers,omitempty"`
	AttachmentsDir string   `yaml:"attachmentsDir,omitempty"` // signal-cli attachment cache dir; derived from configDir when empty
}

// WhatsappConfig holds the non-secret part of whatsapp transport
// configuration. Credentials are NOT here — the whatsmeow session lives in
// the sqlite database at cfg.Paths.WhatsappState, established via QR
// pairing.
type WhatsappConfig struct {
	AllowedNumbers []string `yaml:"allowedNumbers,omitempty"` // E.164, empty = accept all DMs
}

// IMessageConfig configures the macOS-local imessage transport. No
// credentials — access is granted via macOS permissions on the host Mac.
type IMessageConfig struct {
	DBPath         string   `yaml:"dbPath,omitempty"` // default ~/Library/Messages/chat.db
	AllowedHandles []string `yaml:"allowedHandles,omitempty"`
}

// HostClientConfig governs how the gateway spawns and manages
// `coding-agent --mode rpc` subprocesses.
type HostClientConfig struct {
	// CodingAgentBin is the absolute path to the coding-agent executable.
	// Empty means "search $PATH for `vetta`" (the binary name installed by
	// packages/coding-agent).
	CodingAgentBin string `yaml:"codingAgentBin,omitempty"`

	// PoolMaxSize is the maximum number of concurrently held subprocesses.
	// Zero means use DefaultPoolMaxSize.
	PoolMaxSize int `yaml:"poolMaxSize,omitempty"`

	// HandshakeTimeout is how long OpenSession will wait for the subprocess
	// to emit its first JSON line before giving up. Zero means use the
	// default (30s).
	//
	// The desktop host spawns Vetta.app itself as the agent, so the FIRST
	// session after an app launch or update pays a full Electron + asar cold
	// start (measured ~10s on a warm-disk arm64 Mac, vs ~1s once cached).
	// A 10s budget lost that race and surfaced as "handshake timed out" with
	// stderr cut off mid-startup.
	HandshakeTimeout time.Duration `yaml:"handshakeTimeout,omitempty"`

	// CloseTimeout is how long Close() waits for the subprocess to exit
	// gracefully before SIGKILL. Zero means use the default (5s).
	CloseTimeout time.Duration `yaml:"closeTimeout,omitempty"`
}

const (
	DefaultPoolMaxSize      = 8
	DefaultHandshakeTimeout = 30 * time.Second
	DefaultCloseTimeout     = 5 * time.Second
)

// LoggingConfig controls structured logging output.
type LoggingConfig struct {
	Level string `yaml:"level,omitempty"` // debug | info | warn | error; default info
	File  string `yaml:"file,omitempty"`  // empty = stderr only
}

// PathsConfig overrides on-disk file locations. All optional; sane defaults
// are derived from $HOME/.vetta when fields are empty.
type PathsConfig struct {
	// ConversationCwd is the absolute cwd shared by all im-gateway IM
	// sessions (see CONTEXT.md → "im-gateway cwd"). Physically separate
	// from desktop-app's "对话" cwd so the two sides don't share sessions
	// or generated artifacts. Defaults to ~/.vetta/im-gateway/conversation.
	ConversationCwd string `yaml:"conversationCwd,omitempty"`
	State           string `yaml:"state,omitempty"`         // ~/.vetta/im-gateway/state.json
	LogsDir         string `yaml:"logsDir,omitempty"`       // ~/.vetta/im-gateway/logs/
	WechatState     string `yaml:"wechatState,omitempty"`   // ~/.vetta/im-gateway/wechat.json
	WhatsappState   string `yaml:"whatsappState,omitempty"` // ~/.vetta/im-gateway/whatsapp.db
}

// Credentials carries secret values loaded separately from Config.
//
// Loading order (later overrides earlier):
//  1. OS keychain (macOS Keychain / linux Secret Service / Windows
//     Credential Manager)
//  2. ~/.vetta/im-gateway/credentials.yaml (chmod 0600)
//  3. Environment variables (IM_GATEWAY_FEISHU_APP_ID etc.)
//
// Source records which mechanism actually provided the values, used in
// startup logging so users can audit where their secrets came from.
type Credentials struct {
	Feishu   FeishuCredentials
	Telegram TelegramCredentials
	Slack    SlackCredentials
	Discord  DiscordCredentials
	Source   string // "keychain" | "credentials.yaml" | "env" | "merged"
}

type FeishuCredentials struct {
	AppID     string
	AppSecret string
}

type TelegramCredentials struct {
	BotToken string
}

type SlackCredentials struct {
	BotToken string // xoxb-…
	AppToken string // xapp-…
}

type DiscordCredentials struct {
	BotToken string
}

// LoadConfig reads and parses the gateway YAML config from the given path,
// applies environment overrides, and fills in defaults.
//
// Returns a non-nil *Config with defaults applied even when many optional
// fields were left empty in the YAML. A missing file is not an error: an
// empty path or a non-existent file yields a defaulted Config.
//
// Returns an error only on hard failures (file unreadable for reasons other
// than ENOENT, malformed YAML, invalid enum values).
func LoadConfig(path string) (*Config, error) {
	return loadConfig(path)
}

// LoadCredentials gathers secrets from keychain → credentials.yaml → env.
// Implementation in credentials.go.
func LoadCredentials() (*Credentials, error) {
	return loadCredentials()
}
