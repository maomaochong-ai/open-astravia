// Command im-gateway is the entry point for the IM gateway sidecar process.
//
// User-facing entry (driven by desktop-app):
//
//	im-gateway host      Embedded mode. Reads NDJSON config from stdin,
//	                     emits NDJSON events on stdout. No filesystem
//	                     state. Lifecycle bound to parent process via
//	                     stdin EOF or shutdown frame.
//
// Developer / debug subcommands (NOT in the user deployment path):
//
//	im-gateway init      Generate ~/.vetta/im-gateway/config.yaml + credentials.yaml
//	im-gateway start     Connect to the configured IM and start serving
//	im-gateway status    Print connection / pool status of a running gateway
//	im-gateway logs      Tail ~/.vetta/im-gateway/logs/im-gateway.log
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"go.uber.org/zap"

	"vetta-im-gateway/internal/command"
	"vetta-im-gateway/internal/config"
	"vetta-im-gateway/internal/hostclient"
	hclocal "vetta-im-gateway/internal/hostclient/local"
	"vetta-im-gateway/internal/logger"
	"vetta-im-gateway/internal/router"
	"vetta-im-gateway/internal/state"
	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/discord"
	"vetta-im-gateway/internal/transport/feishu"
	"vetta-im-gateway/internal/transport/imessage"
	"vetta-im-gateway/internal/transport/mock"
	signalcli "vetta-im-gateway/internal/transport/signal"
	"vetta-im-gateway/internal/transport/slack"
	"vetta-im-gateway/internal/transport/telegram"
	"vetta-im-gateway/internal/transport/wechat"
)

// version is set at build time via -ldflags. Defaults to a placeholder when
// running `go run` directly.
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		printUsage(os.Stderr)
		os.Exit(2)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "host":
		os.Exit(runHost(args))
	case "init":
		os.Exit(runInit(args))
	case "start":
		os.Exit(runStart(args))
	case "status":
		os.Exit(runStatus(args))
	case "logs":
		os.Exit(runLogs(args))
	case "wechat":
		os.Exit(runWechat(args))
	case "-h", "--help", "help":
		printUsage(os.Stdout)
		os.Exit(0)
	case "--version", "version":
		fmt.Println(version)
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "im-gateway: unknown subcommand %q\n\n", cmd)
		printUsage(os.Stderr)
		os.Exit(2)
	}
}

// =============================================================================
// init
// =============================================================================

func runInit(_ []string) int {
	configPath, credentialsPath, err := config.GenerateTemplate()
	if errors.Is(err, config.ErrAlreadyInitialized) {
		fmt.Fprintf(os.Stderr, "im-gateway: %s already exists; refusing to overwrite\n", configPath)
		fmt.Fprintln(os.Stderr, "edit it directly, or remove it first if you want a fresh template")
		return 1
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway init: %v\n", err)
		return 1
	}

	fmt.Printf("Created %s\n", configPath)
	if credentialsPath != "" {
		fmt.Printf("Created %s (chmod 0600)\n", credentialsPath)
	}
	fmt.Println()
	fmt.Println("Next steps:")
	fmt.Println("  1. Edit the config to choose a transport (mock / feishu)")
	fmt.Println("  2. For feishu: fill in credentials.yaml or run")
	fmt.Println("       keyring set vetta-im-gateway feishu_app_id")
	fmt.Println("       keyring set vetta-im-gateway feishu_app_secret")
	fmt.Println("  3. Run: im-gateway start")
	return 0
}

// =============================================================================
// start
// =============================================================================

func runStart(args []string) int {
	fs := flag.NewFlagSet("start", flag.ContinueOnError)
	configPath := fs.String("config", "", "path to config.yaml (default: ~/.vetta/im-gateway/config.yaml)")
	transportOverride := fs.String("transport", "", "override transport name (mock | feishu)")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	if *configPath == "" {
		p, err := config.DefaultConfigPath()
		if err != nil {
			fmt.Fprintf(os.Stderr, "im-gateway start: %v\n", err)
			return 1
		}
		*configPath = p
	}

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway start: load config: %v\n", err)
		return 1
	}
	if *transportOverride != "" {
		cfg.Transport.Name = config.TransportName(*transportOverride)
	}

	creds, err := config.LoadCredentials()
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway start: load credentials: %v\n", err)
		return 1
	}

	log, err := logger.New(logger.Config{
		Level: cfg.Logging.Level,
		File:  cfg.Logging.File,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway start: logger: %v\n", err)
		return 1
	}
	defer log.Sync() //nolint:errcheck

	// Construct the transport before any state mutations: failure here
	// is the most common startup error and we want to surface it before
	// touching the routing table or pid file.
	tr, err := buildTransport(cfg, creds, log)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway start: transport: %v\n", err)
		return 1
	}

	stateStore := state.NewFileStore(cfg.Paths.State)
	hostClient := hclocal.New(hclocal.Options{
		Bin:              cfg.HostClient.CodingAgentBin,
		HandshakeTimeout: cfg.HostClient.HandshakeTimeout,
		CloseTimeout:     cfg.HostClient.CloseTimeout,
		// Standalone `start` mode is also wechat-aware: same im_send_attachment
		// pipeline applies (see ADR-0006). Cheap to always enable.
		EnableHostBridge: true,
	})
	pool := hostclient.NewProcessPool(hostClient, cfg.HostClient.PoolMaxSize)
	defer func() {
		if err := pool.Shutdown(context.Background()); err != nil {
			log.Warn("pool shutdown", zap.Error(err))
		}
	}()

	r := router.New(tr, command.NewRouter(), stateStore, pool, cfg.Paths.ConversationCwd)
	defer r.Shutdown()

	pidPath := filepath.Join(filepath.Dir(cfg.Paths.State), "im-gateway.pid")
	if err := writePIDFile(pidPath); err != nil {
		log.Warn("write pid file", zap.String("path", pidPath), zap.Error(err))
	}
	defer os.Remove(pidPath)

	printBanner(cfg, creds, *configPath, tr.Name())

	ctx, cancel := signalContext()
	defer cancel()

	log.Info("starting transport",
		zap.String("name", tr.Name()),
		zap.String("config", *configPath),
		zap.String("credentials_source", creds.Source),
	)

	if err := tr.Start(ctx, r); err != nil && !errors.Is(err, context.Canceled) {
		log.Error("transport stopped with error", zap.Error(err))
		return 1
	}
	log.Info("im-gateway shut down cleanly")
	return 0
}

func buildTransport(cfg *config.Config, creds *config.Credentials, log *zap.Logger) (transport.Transport, error) {
	switch cfg.Transport.Name {
	case config.TransportMock:
		return mock.New(mock.Options{}), nil
	case config.TransportFeishu:
		if creds.Feishu.AppID == "" || creds.Feishu.AppSecret == "" {
			return nil, errors.New("feishu transport requires AppID and AppSecret in credentials")
		}
		domain := ""
		if cfg.Transport.Feishu != nil {
			domain = cfg.Transport.Feishu.BaseURL
		}
		return feishu.New(feishu.Options{
			AppID:     creds.Feishu.AppID,
			AppSecret: creds.Feishu.AppSecret,
			Domain:    domain,
			InboxDir:  cfg.Paths.ConversationCwd,
		})
	case config.TransportWechat:
		opts := wechat.Options{
			StatePath: cfg.Paths.WechatState,
			Logger:    log,
			InboxDir:  cfg.Paths.ConversationCwd,
		}
		if cfg.Transport.Wechat != nil {
			opts.QuotaPerWindow = cfg.Transport.Wechat.QuotaPerWindow
			opts.QuotaWindow = cfg.Transport.Wechat.QuotaWindow
		}
		return wechat.New(opts)
	case config.TransportTelegram:
		if creds.Telegram.BotToken == "" {
			return nil, errors.New("telegram transport requires a bot token in credentials")
		}
		opts := telegram.Options{
			BotToken: creds.Telegram.BotToken,
			InboxDir: cfg.Paths.ConversationCwd,
		}
		if cfg.Transport.Telegram != nil {
			opts.AllowedUserIDs = cfg.Transport.Telegram.AllowedUserIDs
		}
		return telegram.New(opts)
	case config.TransportSlack:
		if creds.Slack.BotToken == "" || creds.Slack.AppToken == "" {
			return nil, errors.New("slack transport requires a bot token and an app token in credentials")
		}
		opts := slack.Options{
			BotToken: creds.Slack.BotToken,
			AppToken: creds.Slack.AppToken,
			InboxDir: cfg.Paths.ConversationCwd,
		}
		if cfg.Transport.Slack != nil {
			opts.AllowedUserIDs = cfg.Transport.Slack.AllowedUserIDs
			opts.AllowedChannelIDs = cfg.Transport.Slack.AllowedChannelIDs
		}
		return slack.New(opts)
	case config.TransportDiscord:
		if creds.Discord.BotToken == "" {
			return nil, errors.New("discord transport requires a bot token in credentials")
		}
		opts := discord.Options{
			BotToken: creds.Discord.BotToken,
			InboxDir: cfg.Paths.ConversationCwd,
		}
		if cfg.Transport.Discord != nil {
			opts.AllowedUserIDs = cfg.Transport.Discord.AllowedUserIDs
			opts.AllowedGuildIDs = cfg.Transport.Discord.AllowedGuildIDs
		}
		return discord.New(opts)
	case config.TransportSignal:
		return buildSignalTransport(cfg)
	case config.TransportIMessage:
		opts := imessage.Options{InboxDir: cfg.Paths.ConversationCwd}
		if cfg.Transport.IMessage != nil {
			opts.DBPath = cfg.Transport.IMessage.DBPath
			opts.AllowedHandles = cfg.Transport.IMessage.AllowedHandles
		}
		return imessage.New(opts)
	default:
		return nil, fmt.Errorf("unknown transport: %s", cfg.Transport.Name)
	}
}

// buildSignalTransport wires the signal transport in either mode.
//
// Managed (endpoint empty): the gateway finds signal-cli, asks it which
// account is linked, and supervises the daemon itself — the standalone
// counterpart of what the desktop app does. User-managed (endpoint set):
// we only speak JSON-RPC to the daemon the user already runs, and the
// account must be given because we never inspect their config directory.
func buildSignalTransport(cfg *config.Config) (transport.Transport, error) {
	sig := cfg.Transport.Signal
	if sig == nil {
		sig = &config.SignalConfig{}
	}
	opts := signalcli.Options{
		Account:        sig.Account,
		AllowedNumbers: sig.AllowedNumbers,
		AttachmentsDir: sig.AttachmentsDir,
		InboxDir:       cfg.Paths.ConversationCwd,
	}
	if sig.Endpoint != "" {
		if sig.Account == "" {
			return nil, errors.New("signal transport with transport.signal.endpoint set also requires transport.signal.account (the E.164 number your daemon serves)")
		}
		opts.Endpoint = sig.Endpoint
		return signalcli.New(opts)
	}

	cli := signalcli.CLIOptions{Path: sig.CLIPath, ConfigDir: sig.ConfigDir, ProxyURL: sig.ProxyURL}
	if opts.Account == "" {
		ctx, cancel := context.WithTimeout(context.Background(), signalAccountLookupTimeout)
		defer cancel()
		accounts, err := signalcli.ListAccounts(ctx, cli)
		if err != nil {
			if errors.Is(err, signalcli.ErrCLINotFound) {
				return nil, fmt.Errorf("%w — install it first (%s), then link a device with `signal-cli link -n Vetta`", err, signalcli.InstallHint())
			}
			return nil, err
		}
		if len(accounts) == 0 {
			return nil, errors.New("signal: signal-cli has no linked account — run `signal-cli link -n Vetta` and scan the QR from Signal → Linked devices")
		}
		opts.Account = accounts[0]
	}
	opts.Managed = &signalcli.ManagedOptions{CLI: cli}
	return signalcli.New(opts)
}

// signalAccountLookupTimeout bounds the signal-cli listAccounts probe.
const signalAccountLookupTimeout = 30 * time.Second

func printBanner(cfg *config.Config, creds *config.Credentials, cfgPath, transportName string) {
	fmt.Printf("im-gateway %s\n", version)
	fmt.Printf("  config:      %s\n", cfgPath)
	fmt.Printf("  transport:   %s\n", transportName)
	fmt.Printf("  credentials: %s\n", creds.Source)
	fmt.Printf("  state:       %s\n", cfg.Paths.State)
	fmt.Printf("  log level:   %s\n", cfg.Logging.Level)
	if cfg.Logging.File != "" {
		fmt.Printf("  log file:    %s\n", cfg.Logging.File)
	}
	fmt.Printf("  pool size:   %d\n", cfg.HostClient.PoolMaxSize)
	fmt.Println()
}

// signalContext returns a Context that is cancelled on SIGINT / SIGTERM.
func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()
	return ctx, cancel
}

// =============================================================================
// status
// =============================================================================

func runStatus(_ []string) int {
	cfg, err := loadConfigForReadOnlyCmd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway status: %v\n", err)
		return 1
	}
	pidPath := filepath.Join(filepath.Dir(cfg.Paths.State), "im-gateway.pid")
	pid, err := readPIDFile(pidPath)
	if err != nil {
		fmt.Println("im-gateway: not running (no pid file)")
		return 1
	}
	if !pidAlive(pid) {
		fmt.Printf("im-gateway: stale pid %d (process not running)\n", pid)
		return 1
	}
	fmt.Printf("im-gateway: running (pid %d)\n", pid)
	fmt.Printf("  config: %s\n", filepath.Join(filepath.Dir(cfg.Paths.State), "config.yaml"))
	fmt.Printf("  state:  %s\n", cfg.Paths.State)
	if cfg.Logging.File != "" {
		fmt.Printf("  logs:   %s\n", cfg.Logging.File)
	}
	return 0
}

// =============================================================================
// logs
// =============================================================================

func runLogs(args []string) int {
	fs := flag.NewFlagSet("logs", flag.ContinueOnError)
	follow := fs.Bool("f", false, "follow the log file (like tail -f)")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := loadConfigForReadOnlyCmd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway logs: %v\n", err)
		return 1
	}
	logPath := cfg.Logging.File
	if logPath == "" {
		fmt.Fprintln(os.Stderr, "im-gateway logs: no log file configured (logging.file is empty)")
		return 1
	}

	f, err := os.Open(logPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway logs: %v\n", err)
		return 1
	}
	defer f.Close()

	if _, err := io.Copy(os.Stdout, f); err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway logs: %v\n", err)
		return 1
	}

	if !*follow {
		return 0
	}
	// Simple tail -f loop. Use stat-based polling to avoid pulling in fsnotify.
	for {
		time.Sleep(500 * time.Millisecond)
		if _, err := io.Copy(os.Stdout, f); err != nil {
			return 1
		}
	}
}

// =============================================================================
// shared helpers
// =============================================================================

func loadConfigForReadOnlyCmd() (*config.Config, error) {
	p, err := config.DefaultConfigPath()
	if err != nil {
		return nil, err
	}
	return config.LoadConfig(p)
}

func writePIDFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o644)
}

func readPIDFile(path string) (int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return 0, err
	}
	return pid, nil
}

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := p.Signal(syscall.Signal(0)); err != nil {
		return false
	}
	return true
}

// =============================================================================
// usage
// =============================================================================

func printUsage(w *os.File) {
	fmt.Fprintln(w, "usage: im-gateway <command> [args]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "User mode (driven by desktop-app):")
	fmt.Fprintln(w, "  host      Embedded mode: read NDJSON config from stdin, emit events on stdout")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Developer / debug commands:")
	fmt.Fprintln(w, "  init      Generate config + credentials templates at ~/.vetta/im-gateway/")
	fmt.Fprintln(w, "  start     Run the gateway")
	fmt.Fprintln(w, "  status    Show running gateway status")
	fmt.Fprintln(w, "  logs      Print or tail the gateway log file (-f to follow)")
	fmt.Fprintln(w, "  wechat    Manage WeChat (iLink) account binding (login | status | logout)")
	fmt.Fprintln(w, "  version   Print version and exit")
	fmt.Fprintln(w, "  help      Print this message")
}
