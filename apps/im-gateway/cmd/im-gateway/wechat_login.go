// Wechat (iLink) account binding subcommand.
//
// Usage:
//
//	im-gateway wechat login    # scan-bind a WeChat account
//	im-gateway wechat status   # show currently bound account, if any
//	im-gateway wechat logout   # forget the bound account
//
// Binding requires the user to scan a QR code with their iPhone WeChat
// (Android is not supported by the upstream protocol). The QR is delivered
// as a URL string that we print to the terminal — the user opens it in any
// browser to render the actual QR image, then scans it. We deliberately do
// not pull in a Go QR-rendering dep for this milestone; the link-only flow
// matches the upstream plugin's documented fallback path.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"

	"go.uber.org/zap"

	"vetta-im-gateway/internal/config"
	"vetta-im-gateway/internal/logger"
	"vetta-im-gateway/internal/transport/wechat"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// runWechat is the entry point dispatched from main.go for the `wechat`
// subcommand. It just routes to the per-action handler.
func runWechat(args []string) int {
	if len(args) == 0 {
		printWechatUsage(os.Stderr)
		return 2
	}
	action := args[0]
	rest := args[1:]
	switch action {
	case "login":
		return runWechatLogin(rest)
	case "status":
		return runWechatStatus(rest)
	case "logout":
		return runWechatLogout(rest)
	case "-h", "--help", "help":
		printWechatUsage(os.Stdout)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "im-gateway wechat: unknown action %q\n\n", action)
		printWechatUsage(os.Stderr)
		return 2
	}
}

func printWechatUsage(w *os.File) {
	fmt.Fprintln(w, "usage: im-gateway wechat <action>")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Actions:")
	fmt.Fprintln(w, "  login     Generate a QR code and bind a WeChat account (requires iOS WeChat ≥ 8.0.70)")
	fmt.Fprintln(w, "  status    Show the currently bound account, if any")
	fmt.Fprintln(w, "  logout    Forget the bound account")
}

// =============================================================================
// login
// =============================================================================

func runWechatLogin(args []string) int {
	fs := flag.NewFlagSet("wechat login", flag.ContinueOnError)
	configPath := fs.String("config", "", "path to config.yaml (default: ~/.vetta/im-gateway/config.yaml)")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, log, err := loadConfigForWechat(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat login: %v\n", err)
		return 1
	}
	defer log.Sync() //nolint:errcheck

	store, err := wechat.NewStateStoreForCLI(cfg.Paths.WechatState)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat login: open state: %v\n", err)
		return 1
	}

	if store.HasCredentials() {
		fmt.Println("WeChat account is already bound. Use `im-gateway wechat logout` first if you want to re-bind.")
		return 0
	}

	client := ilink.New(ilink.Options{Logger: zapShimForCLI{log}})

	ctx, cancel := signalContext()
	defer cancel()

	fmt.Println("Generating WeChat login QR code...")
	code, err := client.GenerateQR(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat login: get QR: %v\n", err)
		return 1
	}

	fmt.Println()
	fmt.Println("┌──────────────────────────────────────────────────────────────────┐")
	fmt.Println("│  请用 iPhone 微信扫码（要求微信版本 ≥ 8.0.70，Android 暂不支持）│")
	fmt.Println("└──────────────────────────────────────────────────────────────────┘")
	fmt.Println()
	fmt.Println("在浏览器打开以下链接渲染二维码后用微信扫描：")
	fmt.Println()
	fmt.Printf("    %s\n", code.ImgContent)
	fmt.Println()
	fmt.Println("等待扫码确认...")
	fmt.Println()

	res, err := client.WaitForBind(ctx, code, func(e ilink.BindEvent) {
		switch e.Status {
		case ilink.QRStatusScaned:
			fmt.Println("已扫码，请在微信中确认...")
		case ilink.QRStatusExpired:
			if e.Refresh != nil {
				fmt.Println()
				fmt.Println("二维码已过期，已生成新的二维码：")
				fmt.Printf("    %s\n", e.Refresh.ImgContent)
				fmt.Println()
			}
		case ilink.QRStatusScanedButRedirect:
			if e.Redirect != "" {
				fmt.Printf("服务器路由切换至 %s\n", e.Redirect)
			}
		case ilink.QRStatusConfirmed:
			fmt.Println("已确认。正在保存凭据...")
		}
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			fmt.Println("\n取消。")
			return 1
		}
		fmt.Fprintf(os.Stderr, "im-gateway wechat login: bind failed: %v\n", err)
		return 1
	}

	if err := store.SetCredentials(res.Credentials); err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat login: persist credentials: %v\n", err)
		return 1
	}

	fmt.Println()
	fmt.Println("✅ WeChat 账号绑定成功！")
	fmt.Printf("  ilink_bot_id:  %s\n", res.Credentials.ILinkBotID)
	fmt.Printf("  ilink_user_id: %s\n", res.Credentials.ILinkUserID)
	fmt.Printf("  base_url:      %s\n", res.Credentials.BaseURL)
	fmt.Printf("  state file:    %s\n", cfg.Paths.WechatState)
	fmt.Println()
	fmt.Println("下一步：将 transport.name 设为 wechat，然后运行 im-gateway start")
	return 0
}

// =============================================================================
// status
// =============================================================================

func runWechatStatus(_ []string) int {
	cfg, _, err := loadConfigForWechat("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat status: %v\n", err)
		return 1
	}
	store, err := wechat.NewStateStoreForCLI(cfg.Paths.WechatState)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat status: %v\n", err)
		return 1
	}
	if !store.HasCredentials() {
		fmt.Println("未绑定 WeChat 账号。运行 `im-gateway wechat login` 进行绑定。")
		return 0
	}
	creds := store.Credentials()
	fmt.Println("WeChat 账号已绑定：")
	fmt.Printf("  ilink_bot_id:  %s\n", creds.ILinkBotID)
	fmt.Printf("  ilink_user_id: %s\n", creds.ILinkUserID)
	fmt.Printf("  base_url:      %s\n", creds.BaseURL)
	fmt.Printf("  state file:    %s\n", cfg.Paths.WechatState)
	return 0
}

// =============================================================================
// logout
// =============================================================================

func runWechatLogout(_ []string) int {
	cfg, _, err := loadConfigForWechat("")
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat logout: %v\n", err)
		return 1
	}
	store, err := wechat.NewStateStoreForCLI(cfg.Paths.WechatState)
	if err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat logout: %v\n", err)
		return 1
	}
	if !store.HasCredentials() {
		fmt.Println("未绑定 WeChat 账号，无需登出。")
		return 0
	}
	if err := store.Clear(); err != nil {
		fmt.Fprintf(os.Stderr, "im-gateway wechat logout: %v\n", err)
		return 1
	}
	fmt.Println("已清除 WeChat 凭据。")
	return 0
}

// =============================================================================
// helpers
// =============================================================================

// loadConfigForWechat loads the gateway config + a logger using the same
// defaults runStart uses. Empty configPath → default location.
func loadConfigForWechat(configPath string) (*config.Config, *zap.Logger, error) {
	if configPath == "" {
		p, err := config.DefaultConfigPath()
		if err != nil {
			return nil, nil, err
		}
		configPath = p
	}
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		return nil, nil, fmt.Errorf("load config: %w", err)
	}
	log, err := logger.New(logger.Config{
		Level: cfg.Logging.Level,
		File:  cfg.Logging.File,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("logger: %w", err)
	}
	return cfg, log, nil
}

// zapShimForCLI adapts *zap.Logger to ilink.Logger. Identical to the shim
// in internal/transport/wechat/wechat.go but defined here so the CLI does
// not depend on the wechat package's unexported types.
type zapShimForCLI struct{ l *zap.Logger }

func (z zapShimForCLI) Debug(msg string, fields ...any) { z.l.Sugar().Debugw(msg, fields...) }
func (z zapShimForCLI) Info(msg string, fields ...any)  { z.l.Sugar().Infow(msg, fields...) }
func (z zapShimForCLI) Warn(msg string, fields ...any)  { z.l.Sugar().Warnw(msg, fields...) }
func (z zapShimForCLI) Error(msg string, fields ...any) { z.l.Sugar().Errorw(msg, fields...) }
