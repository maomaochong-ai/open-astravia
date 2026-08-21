package signalcli

// Managed signal-cli lifecycle: locating the executable the user already
// installed, driving the device-linking flow (QR), and supervising a local
// `daemon --http` process on a loopback port.
//
// Rationale: signal-cli is the only way to speak Signal from a third-party
// client (there is no bot API). Making the *user* install it is unavoidable
// without shipping a JVM, but making them also run the daemon, pick a port,
// and copy an E.164 number into settings is not. Everything in this file
// exists so the only manual step left is "install signal-cli once".
//
// Nothing here talks to Signal itself — once the daemon is up, the regular
// JSON-RPC/SSE Transport in signal.go does all the protocol work.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ErrCLINotFound is returned by DiscoverCLI when no signal-cli executable
// exists on PATH or in the well-known install locations. Callers surface it
// to the user together with the platform's install command.
var ErrCLINotFound = errors.New("signal: signal-cli executable not found")

// ErrNoLinkURI is returned when `signal-cli link` finished without ever
// printing a device-link URI. In practice this means signal-cli could not
// reach the Signal servers — the QR can only be produced once provisioning
// is established — so the caller should point at connectivity rather than
// at the scan.
var ErrNoLinkURI = errors.New("signal: signal-cli produced no device-link URI (cannot reach the Signal servers — check the network or proxy)")

// ErrNotLinked is returned when the signal-cli config directory holds no
// linked/registered account yet. Mirrors whatsapp.ErrNotLoggedIn: the host
// layer turns it into awaiting_bind and drives the link flow.
var ErrNotLinked = errors.New("signal: no linked signal-cli account")

// defaultDeviceName is what the user sees under Signal → Linked devices.
const defaultDeviceName = "Vetta"

// daemonReadyTimeout bounds the wait for the daemon's first successful RPC.
// signal-cli on a JVM can take several seconds to boot on a cold start; the
// native Linux build is much faster. 60s is generous rather than tight so a
// slow machine does not fail the first launch.
const daemonReadyTimeout = 60 * time.Second

// daemonReadyPoll is the interval between readiness probes.
const daemonReadyPoll = 250 * time.Millisecond

// stderrTailBytes bounds the captured child stderr kept for error messages.
const stderrTailBytes = 8 * 1024

// linkURIPattern matches the device-link URI signal-cli prints on `link`.
var linkURIPattern = regexp.MustCompile(`sgnl://linkdevice\S+`)

// e164Pattern is the fallback account scraper for signal-cli builds whose
// `listAccounts` output is not JSON.
var e164Pattern = regexp.MustCompile(`\+\d{5,}`)

// CLIOptions locates one signal-cli installation and its state directory.
type CLIOptions struct {
	// Path is the signal-cli executable. Empty means "discover it".
	Path string
	// ConfigDir is passed as `--config`. Empty uses signal-cli's own
	// default location (~/.local/share/signal-cli), which is also what a
	// user who linked via the terminal already populated.
	ConfigDir string
	// ProxyURL routes signal-cli's traffic through a proxy, e.g.
	// "http://127.0.0.1:1080" or "socks5://host:1080". Empty falls back to
	// the process proxy environment, then to the OS proxy settings. See
	// jvmProxyArgs for why this cannot be left to the environment alone.
	ProxyURL string
}

// resolve returns the executable path, discovering it when Path is empty.
func (o CLIOptions) resolve() (string, error) {
	return DiscoverCLI(o.Path)
}

// globalArgs renders everything that must precede the signal-cli
// subcommand: JVM system properties first (they are consumed by the
// runtime), then signal-cli's own global flags.
func (o CLIOptions) globalArgs() []string {
	args := jvmProxyArgs(o.ProxyURL)
	if o.ConfigDir != "" {
		args = append(args, "--config", o.ConfigDir)
	}
	return args
}

// proxyEnvKeys are the variables Go's http.ProxyFromEnvironment consults,
// in both casings — the same set the parent process populates for the
// sidecar. Ordered most specific first: Signal is HTTPS-only.
var proxyEnvKeys = []string{
	"HTTPS_PROXY", "https_proxy",
	"HTTP_PROXY", "http_proxy",
	"ALL_PROXY", "all_proxy",
}

// proxyFromEnv returns the first proxy URL found in the environment.
func proxyFromEnv() string {
	for _, key := range proxyEnvKeys {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	return ""
}

// jvmProxyArgs renders the proxy configuration as `-D` system properties.
//
// signal-cli ships as a JVM/GraalVM program, and neither honours the
// HTTPS_PROXY/HTTP_PROXY environment variables that the rest of the gateway
// (and every Go transport) relies on. On a machine that can only reach
// Signal through a proxy, the symptom is silent: `signal-cli link` never
// prints its device-link URI, waits for a provisioning connection that
// cannot be established, and eventually exits with "Link request timed
// out" — no QR, no useful error.
//
// Resolution order: the explicit URL, then the process environment (the
// parent injects the system proxy there), then `useSystemProxies` so the
// OS-level proxy settings still apply when nothing was exported. No proxy
// anywhere means direct, which is what the properties below degrade to.
func jvmProxyArgs(explicit string) []string {
	raw := strings.TrimSpace(explicit)
	if raw == "" {
		raw = proxyFromEnv()
	}
	if raw == "" {
		return []string{"-Djava.net.useSystemProxies=true"}
	}
	host, port, scheme, ok := parseProxyURL(raw)
	if !ok {
		// Unparseable value: better to let the OS answer than to pass
		// junk properties into signal-cli.
		return []string{"-Djava.net.useSystemProxies=true"}
	}
	if scheme == "socks" {
		return []string{
			"-DsocksProxyHost=" + host,
			"-DsocksProxyPort=" + port,
		}
	}
	args := []string{
		"-Dhttps.proxyHost=" + host,
		"-Dhttps.proxyPort=" + port,
		"-Dhttp.proxyHost=" + host,
		"-Dhttp.proxyPort=" + port,
	}
	if hosts := nonProxyHosts(); hosts != "" {
		args = append(args, "-Dhttp.nonProxyHosts="+hosts)
	}
	return args
}

// parseProxyURL splits a proxy URL into host/port and a coarse scheme
// ("http" or "socks"). A bare "host:port" is accepted as http, mirroring
// Go's own proxy-env leniency.
func parseProxyURL(raw string) (host, port, scheme string, ok bool) {
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return "", "", "", false
	}
	scheme = "http"
	switch strings.ToLower(u.Scheme) {
	case "socks", "socks5", "socks5h", "socks4", "socks4a":
		scheme = "socks"
	}
	port = u.Port()
	if port == "" {
		if scheme == "socks" {
			port = "1080"
		} else if strings.EqualFold(u.Scheme, "https") {
			port = "443"
		} else {
			port = "80"
		}
	}
	return u.Hostname(), port, scheme, true
}

// nonProxyHosts translates NO_PROXY into the `|`-separated form the JVM
// expects. Loopback is always included: a proxy must never be used for the
// daemon endpoint we talk to ourselves.
func nonProxyHosts() string {
	parts := []string{"localhost", "127.0.0.1", "[::1]"}
	for _, key := range []string{"NO_PROXY", "no_proxy"} {
		for _, entry := range strings.Split(os.Getenv(key), ",") {
			if e := strings.TrimSpace(entry); e != "" {
				parts = append(parts, e)
			}
		}
	}
	return strings.Join(parts, "|")
}

// DiscoverCLI resolves the signal-cli executable.
//
// Order: an explicit path (validated), then PATH, then the per-platform
// locations package managers use. Homebrew, apt and scoop all land in one of
// these, which is what lets the desktop app skip asking the user for a path.
func DiscoverCLI(explicit string) (string, error) {
	if explicit != "" {
		if isExecutableFile(explicit) {
			return explicit, nil
		}
		return "", fmt.Errorf("%w: %s is not an executable file", ErrCLINotFound, explicit)
	}
	for _, name := range cliExecutableNames() {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	for _, candidate := range cliCandidatePaths() {
		if isExecutableFile(candidate) {
			return candidate, nil
		}
	}
	return "", ErrCLINotFound
}

// cliExecutableNames lists the PATH names to try, most specific first.
func cliExecutableNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"signal-cli.bat", "signal-cli.exe", "signal-cli"}
	}
	return []string{"signal-cli"}
}

// cliCandidatePaths lists well-known install locations for the platform.
// PATH is checked first, so these only matter for GUI processes that never
// inherited the user's shell PATH — the common case for a launched .app.
func cliCandidatePaths() []string {
	home, _ := os.UserHomeDir()
	var out []string
	switch runtime.GOOS {
	case "darwin":
		out = []string{
			"/opt/homebrew/bin/signal-cli",
			"/usr/local/bin/signal-cli",
			"/opt/local/bin/signal-cli",
		}
		if home != "" {
			out = append(out, filepath.Join(home, ".local", "bin", "signal-cli"))
		}
	case "windows":
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			out = append(out,
				filepath.Join(local, "Programs", "signal-cli", "bin", "signal-cli.bat"),
				filepath.Join(local, "Microsoft", "WinGet", "Links", "signal-cli.exe"),
			)
		}
		if home != "" {
			out = append(out, filepath.Join(home, "scoop", "shims", "signal-cli.cmd"))
		}
	default:
		out = []string{
			"/usr/bin/signal-cli",
			"/usr/local/bin/signal-cli",
			"/snap/bin/signal-cli",
			"/var/lib/flatpak/exports/bin/signal-cli",
		}
		if home != "" {
			out = append(out, filepath.Join(home, ".local", "bin", "signal-cli"))
		}
	}
	return out
}

// isExecutableFile reports whether path is a regular file we may exec. On
// Windows the permission bits carry no meaning, so existence is enough.
func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}

// InstallHint returns the platform's one-line install command, for the
// "signal-cli not found" state in the UI. Kept next to DiscoverCLI so the
// hint and the search paths stay consistent.
func InstallHint() string {
	switch runtime.GOOS {
	case "darwin":
		return "brew install signal-cli"
	case "windows":
		return "scoop install signal-cli"
	default:
		return "见 https://github.com/AsamK/signal-cli/wiki"
	}
}

// =============================================================================
// account discovery
// =============================================================================

// ListAccounts returns the E.164 numbers the signal-cli config directory
// holds. An empty slice (with a nil error) means "installed but not linked".
//
// signal-cli must not be running as a daemon on the same config directory
// while this runs — it takes the same lock. Callers use it before starting
// the daemon, or read the daemon's `listAccounts` RPC instead.
func ListAccounts(ctx context.Context, opts CLIOptions) ([]string, error) {
	bin, err := opts.resolve()
	if err != nil {
		return nil, err
	}
	args := append(opts.globalArgs(), "--output=json", "listAccounts")
	cmd := exec.CommandContext(ctx, bin, args...)
	configureProcessGroup(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("signal: listAccounts failed: %w (%s)", err, tail(stderr.String()))
	}
	return parseAccounts(stdout.Bytes()), nil
}

// parseAccounts extracts numbers from `listAccounts --output=json`. The
// shape has changed across signal-cli versions (array of objects keyed
// `number` or `account`), so parsing is lenient and falls back to scraping
// E.164 numbers out of plain text.
func parseAccounts(raw []byte) []string {
	var rows []struct {
		Number  string `json:"number"`
		Account string `json:"account"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(raw), &rows); err == nil {
		var out []string
		for _, r := range rows {
			n := r.Number
			if n == "" {
				n = r.Account
			}
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}
	var out []string
	seen := map[string]struct{}{}
	for _, m := range e164Pattern.FindAllString(string(raw), -1) {
		if _, dup := seen[m]; dup {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	return out
}

// =============================================================================
// device linking (QR)
// =============================================================================

// Link runs `signal-cli link` and reports the device-link URI through onURI
// as soon as signal-cli prints it. The URI is what the caller renders as a
// QR code; the user scans it from Signal → Settings → Linked devices.
//
// Blocks until the link completes (the process exits), ctx is cancelled, or
// signal-cli fails. On success the newly linked account number is returned.
func Link(ctx context.Context, opts CLIOptions, deviceName string, onURI func(string)) (string, error) {
	bin, err := opts.resolve()
	if err != nil {
		return "", err
	}
	if deviceName == "" {
		deviceName = defaultDeviceName
	}

	args := append(opts.globalArgs(), "link", "-n", deviceName)
	cmd := exec.CommandContext(ctx, bin, args...)
	configureProcessGroup(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("signal link: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("signal link: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("signal link: start %s: %w", bin, err)
	}

	// signal-cli prints the URI on stdout, diagnostics on stderr; scan both
	// so a version that swaps them still works.
	var stderrTail bytes.Buffer
	var sawURI atomic.Bool
	report := func(uri string) {
		sawURI.Store(true)
		if onURI != nil {
			onURI(uri)
		}
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); scanForLinkURI(stdout, nil, report) }()
	go func() { defer wg.Done(); scanForLinkURI(stderrPipe, &stderrTail, report) }()
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		if !sawURI.Load() {
			// No URI ever appeared: the failure is upstream of the scan,
			// so say so instead of surfacing a bare exit status.
			return "", fmt.Errorf("%w: %v (%s)", ErrNoLinkURI, err, tail(stderrTail.String()))
		}
		return "", fmt.Errorf("signal link: %w (%s)", err, tail(stderrTail.String()))
	}
	if !sawURI.Load() {
		return "", ErrNoLinkURI
	}

	// The link succeeded; resolve which number we are now linked to.
	accounts, err := ListAccounts(ctx, opts)
	if err != nil {
		return "", err
	}
	if len(accounts) == 0 {
		return "", ErrNotLinked
	}
	return accounts[len(accounts)-1], nil
}

// scanForLinkURI forwards every `sgnl://linkdevice…` occurrence to onURI.
// When sink is non-nil the raw stream is also mirrored into it (bounded) so
// failures can quote signal-cli's own diagnostics.
func scanForLinkURI(r io.Reader, sink *bytes.Buffer, onURI func(string)) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 4*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if sink != nil && sink.Len() < stderrTailBytes {
			sink.WriteString(line)
			sink.WriteByte('\n')
		}
		if uri := linkURIPattern.FindString(line); uri != "" && onURI != nil {
			onURI(uri)
		}
	}
}

// =============================================================================
// daemon supervision
// =============================================================================

// DaemonOptions configures StartDaemon.
type DaemonOptions struct {
	CLI CLIOptions
	// Account optionally restricts the daemon to one registered number.
	// Empty lets signal-cli serve every account in the config directory.
	Account string
	// ReadyTimeout bounds the wait for the daemon's first working RPC.
	// Zero uses daemonReadyTimeout.
	ReadyTimeout time.Duration
	// Log receives lifecycle and child-stderr lines. Optional.
	Log func(level, msg string, fields map[string]any)
}

// Daemon is a supervised `signal-cli daemon --http` child process bound to
// a loopback port. Stop terminates it; Done reports its exit.
type Daemon struct {
	endpoint string
	cmd      *exec.Cmd

	// done is closed once the child has exited; exitErr then holds its
	// exit status. A closed channel (rather than a value) lets every
	// observer — Stop, waitReady, the transport's Start loop — see the
	// exit, instead of the first reader consuming it.
	done chan struct{}
	once sync.Once

	mu      sync.Mutex
	stderr  bytes.Buffer
	exitErr error
}

// StartDaemon spawns signal-cli's HTTP daemon on a free loopback port and
// waits until it answers RPC. The returned Daemon owns the child process.
func StartDaemon(ctx context.Context, opts DaemonOptions) (*Daemon, error) {
	bin, err := opts.CLI.resolve()
	if err != nil {
		return nil, err
	}
	port, err := freeLoopbackPort()
	if err != nil {
		return nil, fmt.Errorf("signal daemon: %w", err)
	}
	addr := fmt.Sprintf("127.0.0.1:%d", port)

	args := opts.CLI.globalArgs()
	if opts.Account != "" {
		args = append(args, "-a", opts.Account)
	}
	// --receive-mode on-connection would only receive while a client is
	// attached; the bridge needs the daemon receiving continuously.
	args = append(args, "daemon", "--http", addr)

	cmd := exec.Command(bin, args...)
	configureProcessGroup(cmd)
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("signal daemon: %w", err)
	}
	cmd.Stdout = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("signal daemon: start %s: %w", bin, err)
	}

	d := &Daemon{
		endpoint: "http://" + addr,
		cmd:      cmd,
		done:     make(chan struct{}),
	}
	go d.pumpStderr(stderrPipe, opts.Log)
	go func() {
		err := cmd.Wait()
		d.mu.Lock()
		d.exitErr = err
		d.mu.Unlock()
		close(d.done)
	}()

	readyTimeout := opts.ReadyTimeout
	if readyTimeout == 0 {
		readyTimeout = daemonReadyTimeout
	}
	if err := d.waitReady(ctx, readyTimeout); err != nil {
		_ = d.Stop()
		return nil, err
	}
	if opts.Log != nil {
		opts.Log("info", "signal-cli daemon ready", map[string]any{"endpoint": d.endpoint, "bin": bin})
	}
	return d, nil
}

// Endpoint is the daemon's base URL, e.g. http://127.0.0.1:53211.
func (d *Daemon) Endpoint() string { return d.endpoint }

// Done is closed when the child exits. Err then reports how it exited.
func (d *Daemon) Done() <-chan struct{} { return d.done }

// Err is the child's exit error, or nil while it is still running or after
// a clean exit.
func (d *Daemon) Err() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.exitErr
}

// Stop terminates the child process (and its group) and waits briefly for
// it to exit. Idempotent.
func (d *Daemon) Stop() error {
	d.once.Do(func() {
		if d.cmd.Process == nil {
			return
		}
		_ = terminateProcessGroup(d.cmd)
		select {
		case <-d.done:
		case <-time.After(5 * time.Second):
			_ = d.cmd.Process.Kill()
		}
	})
	return nil
}

// waitReady polls the daemon's RPC endpoint until it answers, the child
// exits, ctx is cancelled, or the timeout fires.
func (d *Daemon) waitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	probe := &Transport{endpoint: d.endpoint, rpcClient: newProbeClient()}
	for {
		if _, err := probe.rpcCall(ctx, "ready", "version", map[string]any{}); err == nil {
			return nil
		}
		select {
		case <-d.done:
			return fmt.Errorf("signal daemon: exited during startup: %v (%s)", d.Err(), tail(d.stderrTail()))
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(daemonReadyPoll):
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("signal daemon: not ready after %s (%s)", timeout, tail(d.stderrTail()))
		}
	}
}

// pumpStderr mirrors the child's stderr into the bounded tail buffer and,
// when a logger is supplied, into the host log stream.
func (d *Daemon) pumpStderr(r io.Reader, log func(string, string, map[string]any)) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 4*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		d.mu.Lock()
		if d.stderr.Len() < stderrTailBytes {
			d.stderr.WriteString(line)
			d.stderr.WriteByte('\n')
		}
		d.mu.Unlock()
		if log != nil && strings.TrimSpace(line) != "" {
			log("debug", "signal-cli: "+line, nil)
		}
	}
}

func (d *Daemon) stderrTail() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stderr.String()
}

// freeLoopbackPort asks the kernel for an unused loopback port. The socket
// is closed before signal-cli binds it — a race window we accept because the
// alternative (a fixed port) collides with the user's own daemon.
func freeLoopbackPort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

// newProbeClient is the short-timeout HTTP client used for readiness polls.
func newProbeClient() *http.Client { return &http.Client{Timeout: 3 * time.Second} }

// tail trims a captured stderr blob down to its last line(s) for inclusion
// in an error message.
func tail(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "no output"
	}
	lines := strings.Split(s, "\n")
	if len(lines) > 3 {
		lines = lines[len(lines)-3:]
	}
	return strings.Join(lines, " | ")
}
