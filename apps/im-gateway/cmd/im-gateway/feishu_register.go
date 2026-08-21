package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"vetta-im-gateway/internal/transport/feishu"
)

// `im-gateway feishu register` is the standalone-CLI half of the one-click
// app registration the desktop app drives over hostproto: it prints the
// verification link instead of rendering a QR image, and hands the minted
// credentials back to the operator rather than persisting them.
//
// Writing them out is deliberately left to the user: credentials.yaml is a
// hand-maintained file (and the keychain is the recommended store), so the
// command prints exactly what to put where instead of rewriting it.
func runFeishu(args []string) int {
	if len(args) == 0 {
		printFeishuUsage(os.Stderr)
		return 2
	}
	action := args[0]
	rest := args[1:]
	switch action {
	case "register":
		return runFeishuRegister(rest)
	case "-h", "--help", "help":
		printFeishuUsage(os.Stdout)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "im-gateway feishu: unknown action %q\n\n", action)
		printFeishuUsage(os.Stderr)
		return 2
	}
}

func printFeishuUsage(w *os.File) {
	fmt.Fprintln(w, "usage: im-gateway feishu <action>")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Actions:")
	fmt.Fprintln(w, "  register  扫码一键创建飞书应用，直接拿到 App ID / App Secret")
}

func runFeishuRegister(args []string) int {
	fs := flag.NewFlagSet("feishu register", flag.ContinueOnError)
	domain := fs.String("domain", "", "认证域名（默认 "+feishu.AccountsDomainFeishu+"）")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	ctx, cancel := signalContext()
	defer cancel()

	fmt.Println("正在向飞书开放平台申请一键创建链接...")
	res, err := feishu.Register(ctx, feishu.RegisterOptions{
		Domain:     *domain,
		Source:     feishuRegisterSource,
		Addons:     feishuRegisterAddons(),
		CreateOnly: true,
		AppPreset:  &feishu.RegisterAppPreset{Name: feishuBotName, Desc: feishuBotDesc},
		OnQRCode: func(qr feishu.RegisterQRCode) {
			fmt.Println()
			fmt.Println("用飞书扫描下面的链接（或在飞书中直接打开），按提示创建应用并确认权限：")
			fmt.Println()
			fmt.Printf("    %s\n", qr.URL)
			fmt.Println()
			fmt.Printf("链接 %d 秒后过期。等待确认...\n", qr.ExpireIn)
		},
	})
	if err != nil {
		var regErr *feishu.RegisterError
		switch {
		case errors.As(err, &regErr) && regErr.Code == feishu.RegisterErrAccessDenied:
			fmt.Fprintln(os.Stderr, "im-gateway feishu register: 授权被拒绝")
		case errors.As(err, &regErr) && regErr.Code == feishu.RegisterErrExpiredToken:
			fmt.Fprintln(os.Stderr, "im-gateway feishu register: 链接已过期，请重新执行")
		default:
			fmt.Fprintf(os.Stderr, "im-gateway feishu register: %v\n", err)
		}
		return 1
	}

	fmt.Println()
	fmt.Println("应用创建成功。请把下面两项写入凭据存储：")
	fmt.Println()
	fmt.Printf("  App ID:     %s\n", res.AppID)
	fmt.Printf("  App Secret: %s\n", res.AppSecret)
	fmt.Println()
	fmt.Println("推荐存入系统钥匙串：")
	fmt.Println("  security add-generic-password -s vetta-im-gateway -a feishu_app_id     -w")
	fmt.Println("  security add-generic-password -s vetta-im-gateway -a feishu_app_secret -w")
	fmt.Println()
	fmt.Println("或写入 ~/.vetta/im-gateway/credentials.yaml 的 feishu.appId / feishu.appSecret（文件权限 0600）。")
	if res.TenantBrand == "lark" {
		fmt.Println()
		fmt.Printf("检测到 Lark 租户：请在 config.yaml 中把 transport.feishu.baseUrl 设为 %s\n", larkOpenBaseURL)
	}
	return 0
}
