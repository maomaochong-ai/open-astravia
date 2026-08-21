package signalcli

// Tests for the managed signal-cli layer: executable discovery, account
// parsing, the device-link flow, and daemon supervision.
//
// The "signal-cli" under test is this very test binary, re-executed through
// a tiny shell wrapper (fakeCLI) and dispatched by TestHelperSignalCLI. That
// gives a real child process — real pipes, a real HTTP daemon, a real
// SIGTERM on Stop — without depending on signal-cli being installed.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

const fakeCLIEnv = "VETTA_FAKE_SIGNAL_CLI"

const fakeAccount = "+15551234567"

const fakeLinkURI = "sgnl://linkdevice?uuid=abc&pub_key=def"

// fakeCLI writes an executable wrapper that re-enters this test binary as
// the fake signal-cli, and returns its path. Skips on Windows, where the
// shell wrapper trick does not apply.
func fakeCLI(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake signal-cli wrapper requires a POSIX shell")
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "signal-cli")
	script := fmt.Sprintf("#!/bin/sh\n%s=1 exec %q -test.run=TestHelperSignalCLI -- \"$@\"\n", fakeCLIEnv, self)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake cli: %v", err)
	}
	return path
}

// TestHelperSignalCLI is the fake signal-cli. It only runs when the wrapper
// script invokes it; a normal `go test` run skips it.
func TestHelperSignalCLI(t *testing.T) {
	if os.Getenv(fakeCLIEnv) != "1" {
		t.Skip("helper process")
	}
	args := os.Args
	for i, a := range args {
		if a == "--" {
			args = args[i+1:]
			break
		}
	}
	if dest := os.Getenv("VETTA_FAKE_SIGNAL_ARGS_FILE"); dest != "" {
		_ = os.WriteFile(dest, []byte(strings.Join(args, "\n")), 0o600)
	}
	switch {
	case hasArg(args, "listAccounts"):
		if os.Getenv("VETTA_FAKE_SIGNAL_NO_ACCOUNT") == "1" {
			fmt.Println("[]")
		} else {
			fmt.Printf("[{\"number\":%q,\"path\":\"/tmp\"}]\n", fakeAccount)
		}
		os.Exit(0)
	case hasArg(args, "link"):
		fmt.Println("some banner line")
		if os.Getenv("VETTA_FAKE_SIGNAL_NO_URI") == "1" {
			// Mirrors an unreachable-Signal run: no URI, non-zero exit.
			fmt.Fprintln(os.Stderr, "Link request timed out, please try again.")
			os.Exit(1)
		}
		fmt.Println(fakeLinkURI)
		os.Exit(0)
	case hasArg(args, "daemon"):
		serveFakeDaemon(argValue(args, "--http"))
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "unexpected args: %v\n", args)
		os.Exit(2)
	}
}

// serveFakeDaemon answers just enough JSON-RPC for the readiness probe and
// keeps an SSE stream open, then blocks until the parent terminates it.
func serveFakeDaemon(addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/rpc", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"version":"0.0.0-fake"}}`))
	})
	mux.HandleFunc("/api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
	})
	_ = http.ListenAndServe(addr, mux) //nolint:gosec // test-only loopback server
	select {}
}

func hasArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

func argValue(args []string, flag string) string {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

// =============================================================================

func TestDiscoverCLI_ExplicitPath(t *testing.T) {
	bin := fakeCLI(t)

	got, err := DiscoverCLI(bin)
	if err != nil {
		t.Fatalf("DiscoverCLI(explicit): %v", err)
	}
	if got != bin {
		t.Fatalf("path = %q, want %q", got, bin)
	}

	if _, err := DiscoverCLI(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("expected error for a missing explicit path")
	}
}

func TestDiscoverCLI_FromPATH(t *testing.T) {
	bin := fakeCLI(t)
	t.Setenv("PATH", filepath.Dir(bin))

	got, err := DiscoverCLI("")
	if err != nil {
		t.Fatalf("DiscoverCLI(PATH): %v", err)
	}
	if got != bin {
		t.Fatalf("path = %q, want %q", got, bin)
	}
}

func TestDiscoverCLI_NotFound(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())

	// The well-known candidate paths are absolute and may genuinely exist
	// on a developer machine with signal-cli installed; only assert the
	// error when nothing was found.
	if _, err := DiscoverCLI(""); err != nil && !errorsIs(err, ErrCLINotFound) {
		t.Fatalf("err = %v, want ErrCLINotFound", err)
	}
}

func errorsIs(err, target error) bool {
	return err != nil && strings.Contains(err.Error(), target.Error())
}

func TestParseAccounts(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"json number", `[{"number":"+8613800000000"}]`, []string{"+8613800000000"}},
		{"json account key", `[{"account":"+15551110000"}]`, []string{"+15551110000"}},
		{"empty json", `[]`, nil},
		{"plain text fallback", "Number: +4915112345678 (linked)\n", []string{"+4915112345678"}},
		{"plain text dedup", "+4915112345678 +4915112345678", []string{"+4915112345678"}},
		{"garbage", "no accounts here", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseAccounts([]byte(tc.raw))
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestListAccounts_ReadsFakeCLI(t *testing.T) {
	opts := CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir()}

	accounts, err := ListAccounts(context.Background(), opts)
	if err != nil {
		t.Fatalf("ListAccounts: %v", err)
	}
	if len(accounts) != 1 || accounts[0] != fakeAccount {
		t.Fatalf("accounts = %v, want [%s]", accounts, fakeAccount)
	}
}

func TestLink_EmitsURIAndResolvesAccount(t *testing.T) {
	opts := CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir()}

	var uris []string
	account, err := Link(context.Background(), opts, "Vetta", func(uri string) {
		uris = append(uris, uri)
	})
	if err != nil {
		t.Fatalf("Link: %v", err)
	}
	if len(uris) != 1 || uris[0] != fakeLinkURI {
		t.Fatalf("uris = %v, want [%s]", uris, fakeLinkURI)
	}
	if account != fakeAccount {
		t.Fatalf("account = %q, want %q", account, fakeAccount)
	}
}

func TestLink_NoAccountAfterSuccess(t *testing.T) {
	t.Setenv("VETTA_FAKE_SIGNAL_NO_ACCOUNT", "1")
	opts := CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir()}

	if _, err := Link(context.Background(), opts, "Vetta", nil); err == nil {
		t.Fatal("expected ErrNotLinked when listAccounts stays empty")
	}
}

func TestStartDaemon_ReadyThenStop(t *testing.T) {
	opts := DaemonOptions{
		CLI:          CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir()},
		Account:      fakeAccount,
		ReadyTimeout: 20 * time.Second,
	}

	d, err := StartDaemon(context.Background(), opts)
	if err != nil {
		t.Fatalf("StartDaemon: %v", err)
	}
	if !strings.HasPrefix(d.Endpoint(), "http://127.0.0.1:") {
		t.Fatalf("endpoint = %q, want a loopback URL", d.Endpoint())
	}

	// The daemon is reachable: the readiness probe already proved it, so a
	// plain RPC must work too.
	resp, err := http.Post(d.Endpoint()+"/api/v1/rpc", "application/json", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"version"}`))
	if err != nil {
		t.Fatalf("rpc: %v", err)
	}
	defer resp.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode rpc: %v", err)
	}
	if body["result"] == nil {
		t.Fatalf("rpc result missing: %v", body)
	}

	if err := d.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case <-d.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("daemon did not exit after Stop")
	}
	// Stop is idempotent.
	if err := d.Stop(); err != nil {
		t.Fatalf("second Stop: %v", err)
	}
}

func TestStartDaemon_CLINotFound(t *testing.T) {
	_, err := StartDaemon(context.Background(), DaemonOptions{
		CLI: CLIOptions{Path: filepath.Join(t.TempDir(), "absent")},
	})
	if err == nil {
		t.Fatal("expected an error for a missing executable")
	}
}

func TestManagedTransport_StartsAndStopsDaemon(t *testing.T) {
	bin := fakeCLI(t)
	tr, err := New(Options{
		Account: fakeAccount,
		Managed: &ManagedOptions{CLI: CLIOptions{Path: bin, ConfigDir: t.TempDir()}},
	})
	if err != nil {
		t.Fatalf("New(managed): %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- tr.Start(context.Background(), transport.MessageHandlerFunc(
			func(context.Context, transport.InboundMessage) error { return nil }))
	}()

	// Start blocks in the SSE loop once the daemon is up; the endpoint is
	// assigned before that, so poll for it.
	deadline := time.Now().Add(30 * time.Second)
	for tr.baseURL() == "" {
		if time.Now().After(deadline) {
			t.Fatal("managed daemon never came up")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !strings.HasPrefix(tr.baseURL(), "http://127.0.0.1:") {
		t.Fatalf("endpoint = %q", tr.baseURL())
	}

	if err := tr.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("Start did not return after Stop")
	}

	// The child must be gone, not orphaned.
	if err := exec.Command("pgrep", "-f", bin).Run(); err == nil {
		t.Fatal("fake signal-cli still running after Stop")
	}
}

func TestNew_ManagedRejectsEndpoint(t *testing.T) {
	_, err := New(Options{
		Endpoint: "http://127.0.0.1:8080",
		Account:  fakeAccount,
		Managed:  &ManagedOptions{},
	})
	if err == nil {
		t.Fatal("expected managed mode to reject an explicit endpoint")
	}
}

func TestNew_ManagedDerivesAttachmentsDir(t *testing.T) {
	cfgDir := t.TempDir()
	tr, err := New(Options{
		Account: fakeAccount,
		Managed: &ManagedOptions{CLI: CLIOptions{ConfigDir: cfgDir}},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if want := filepath.Join(cfgDir, "attachments"); tr.opts.AttachmentsDir != want {
		t.Fatalf("AttachmentsDir = %q, want %q", tr.opts.AttachmentsDir, want)
	}
}

func TestJVMProxyArgs(t *testing.T) {
	// The proxy must never be hard-coded: it comes from the explicit
	// option, then the environment the parent populates, and finally the
	// OS settings.
	for _, key := range proxyEnvKeys {
		t.Setenv(key, "")
	}
	t.Setenv("NO_PROXY", "")

	cases := []struct {
		name     string
		explicit string
		env      map[string]string
		want     []string
	}{
		{
			name:     "explicit http proxy",
			explicit: "http://127.0.0.1:1080",
			want: []string{
				"-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=1080",
				"-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=1080",
			},
		},
		{
			name:     "port is taken from the url, not assumed",
			explicit: "http://proxy.corp:3128",
			want: []string{
				"-Dhttps.proxyHost=proxy.corp", "-Dhttps.proxyPort=3128",
				"-Dhttp.proxyHost=proxy.corp", "-Dhttp.proxyPort=3128",
			},
		},
		{
			name:     "socks proxy uses the socks properties",
			explicit: "socks5://127.0.0.1:7891",
			want:     []string{"-DsocksProxyHost=127.0.0.1", "-DsocksProxyPort=7891"},
		},
		{
			name:     "bare host:port is accepted",
			explicit: "10.0.0.9:8080",
			want: []string{
				"-Dhttps.proxyHost=10.0.0.9", "-Dhttps.proxyPort=8080",
				"-Dhttp.proxyHost=10.0.0.9", "-Dhttp.proxyPort=8080",
			},
		},
		{
			name: "falls back to the environment the parent injected",
			env:  map[string]string{"HTTPS_PROXY": "http://192.168.1.5:9000"},
			want: []string{
				"-Dhttps.proxyHost=192.168.1.5", "-Dhttps.proxyPort=9000",
				"-Dhttp.proxyHost=192.168.1.5", "-Dhttp.proxyPort=9000",
			},
		},
		{
			name: "no proxy anywhere defers to the OS settings",
			want: []string{"-Djava.net.useSystemProxies=true"},
		},
		{
			name:     "garbage defers to the OS settings",
			explicit: "://nonsense",
			want:     []string{"-Djava.net.useSystemProxies=true"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, key := range proxyEnvKeys {
				t.Setenv(key, "")
			}
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			got := jvmProxyArgs(tc.explicit)
			for _, want := range tc.want {
				if !hasArg(got, want) {
					t.Fatalf("args = %v, want %q", got, want)
				}
			}
		})
	}
}

func TestJVMProxyArgs_NonProxyHostsKeepsLoopbackDirect(t *testing.T) {
	for _, key := range proxyEnvKeys {
		t.Setenv(key, "")
	}
	t.Setenv("NO_PROXY", "example.internal")

	args := jvmProxyArgs("http://127.0.0.1:1080")

	var nonProxy string
	for _, a := range args {
		if strings.HasPrefix(a, "-Dhttp.nonProxyHosts=") {
			nonProxy = a
		}
	}
	if nonProxy == "" {
		t.Fatalf("args = %v, want a nonProxyHosts entry", args)
	}
	for _, want := range []string{"localhost", "127.0.0.1", "example.internal"} {
		if !strings.Contains(nonProxy, want) {
			t.Fatalf("%s missing %q", nonProxy, want)
		}
	}
}

func TestGlobalArgs_ProxyPropertiesPrecedeSubcommand(t *testing.T) {
	argsFile := filepath.Join(t.TempDir(), "args")
	t.Setenv("VETTA_FAKE_SIGNAL_ARGS_FILE", argsFile)
	opts := CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir(), ProxyURL: "http://127.0.0.1:1080"}

	if _, err := ListAccounts(context.Background(), opts); err != nil {
		t.Fatalf("ListAccounts: %v", err)
	}

	recorded := strings.Split(readFile(t, argsFile), "\n")
	proxyIdx, subIdx := -1, -1
	for i, a := range recorded {
		if a == "-Dhttps.proxyHost=127.0.0.1" {
			proxyIdx = i
		}
		if a == "listAccounts" {
			subIdx = i
		}
	}
	if proxyIdx < 0 || subIdx < 0 {
		t.Fatalf("recorded args = %v", recorded)
	}
	// signal-cli consumes -D options only before the subcommand.
	if proxyIdx > subIdx {
		t.Fatalf("proxy property at %d must precede the subcommand at %d: %v", proxyIdx, subIdx, recorded)
	}
}

// TestLink_NoURIReportsUnreachable pins the diagnosis for the real-world
// failure: with Signal unreachable, signal-cli prints no URI and exits 1.
// The caller must learn that, not just "exit status 1".
func TestLink_NoURIReportsUnreachable(t *testing.T) {
	t.Setenv("VETTA_FAKE_SIGNAL_NO_URI", "1")
	opts := CLIOptions{Path: fakeCLI(t), ConfigDir: t.TempDir()}

	_, err := Link(context.Background(), opts, "Vetta", func(string) {
		t.Fatal("no URI should have been reported")
	})

	if !errors.Is(err, ErrNoLinkURI) {
		t.Fatalf("err = %v, want ErrNoLinkURI", err)
	}
	if !strings.Contains(err.Error(), "Link request timed out") {
		t.Fatalf("err = %v, want signal-cli's own diagnostics included", err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}
