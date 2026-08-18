package ilink

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// FixedQRBaseURL is the hardcoded host the upstream client uses for the
// scan-to-bind dance. After confirmation, all messaging traffic moves to
// the per-account BaseURL returned in QRStatusResp.Confirmed.
const FixedQRBaseURL = "https://ilinkai.weixin.qq.com"

// Default protocol identity. These match what the official
// @tencent-weixin/openclaw-weixin@2.1.7 plugin advertises. Servers appear
// to use these for fingerprinting / routing — diverging from them is the
// quickest way to get our requests treated as third-party traffic.
const (
	DefaultILinkAppID         = "bot"
	DefaultChannelVersion     = "2.1.7"
	DefaultLongPollTimeout    = 35 * time.Second
	DefaultAPITimeout         = 15 * time.Second
	DefaultConfigCallTimeout  = 10 * time.Second
)

// ClientVersion encodes a SemVer string into the uint32 the iLink server
// expects in the iLink-App-ClientVersion header:
//
//	(major & 0xff) << 16 | (minor & 0xff) << 8 | (patch & 0xff)
//
// e.g. "2.1.7" -> (2<<16)|(1<<8)|7 = 131335.
func ClientVersion(semver string) uint32 {
	parts := strings.SplitN(semver, ".", 3)
	get := func(i int) uint32 {
		if i >= len(parts) {
			return 0
		}
		n, err := strconv.Atoi(parts[i])
		if err != nil || n < 0 {
			return 0
		}
		return uint32(n) & 0xff
	}
	return get(0)<<16 | get(1)<<8 | get(2)
}

// Doer is the minimal HTTP interface the client depends on. Tests inject a
// fake; production uses the package-default *http.Client.
type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

// Logger is the structured logging hook the client calls into. zap.Logger
// satisfies this transitively but we declare a tiny interface so the ilink
// package itself does not depend on zap.
type Logger interface {
	Debug(msg string, fields ...any)
	Info(msg string, fields ...any)
	Warn(msg string, fields ...any)
	Error(msg string, fields ...any)
}

// nopLogger is the default when no Logger is provided.
type nopLogger struct{}

func (nopLogger) Debug(string, ...any) {}
func (nopLogger) Info(string, ...any)  {}
func (nopLogger) Warn(string, ...any)  {}
func (nopLogger) Error(string, ...any) {}

// Options configures Client construction.
type Options struct {
	// HTTPClient is the underlying transport. nil → http.DefaultClient
	// wrapped with a longer timeout suitable for long-polling.
	HTTPClient Doer

	// AppID overrides the iLink-App-Id header. Empty → DefaultILinkAppID.
	AppID string

	// ChannelVersion overrides the value sent in BaseInfo.channel_version
	// AND used to compute the iLink-App-ClientVersion header. Empty →
	// DefaultChannelVersion. Bumping this when the upstream plugin
	// publishes a new version is the easiest mitigation against
	// fingerprint-based blocking.
	ChannelVersion string

	// Logger receives debug/info/warn/error events. Optional.
	Logger Logger

	// LongPollTimeout overrides the client-side ceiling for getupdates and
	// QR-status long-polls. Zero → DefaultLongPollTimeout.
	LongPollTimeout time.Duration

	// APITimeout overrides the client-side timeout for non-long-poll calls
	// (sendmessage, getuploadurl). Zero → DefaultAPITimeout.
	APITimeout time.Duration
}

// Client speaks the iLink bot protocol. Construct via New or Restore; the
// zero value is not usable.
//
// A Client is safe for concurrent use: send and getupdates may run on
// separate goroutines. The mutable per-account state (BaseURL after IDC
// redirect, the long-poll cursor) is held via atomic.Pointer.
type Client struct {
	httpc           Doer
	appID           string
	channelVersion  string
	clientVersion   uint32
	longPollTimeout time.Duration
	apiTimeout      time.Duration
	logger          Logger

	// baseURL is the per-account messaging host (e.g. https://foo.weixin.qq.com).
	// nil before bind; updated atomically when Restore or SetCredentials is called.
	baseURL atomic.Pointer[string]

	// botToken is the per-account bearer token. nil before bind.
	botToken atomic.Pointer[string]

	// typingTickets caches the per-peer typing_ticket fetched from getconfig
	// (see typing.go). Guarded by typingMu; entries are dropped on a rejected
	// sendtyping so the next pulse refetches.
	typingMu      sync.Mutex
	typingTickets map[string]string
}

// New constructs a fresh Client with no credentials. Used to drive the QR
// bind flow before any token is available.
func New(opts Options) *Client {
	c := &Client{
		httpc:           opts.HTTPClient,
		appID:           opts.AppID,
		channelVersion:  opts.ChannelVersion,
		longPollTimeout: opts.LongPollTimeout,
		apiTimeout:      opts.APITimeout,
		logger:          opts.Logger,
	}
	if c.httpc == nil {
		// 0 = no client-side timeout. We rely on per-request context
		// deadlines instead so long-poll can hold for ~35s without the
		// default 0 of net/http biting us either way.
		c.httpc = &http.Client{}
	}
	if c.appID == "" {
		c.appID = DefaultILinkAppID
	}
	if c.channelVersion == "" {
		c.channelVersion = DefaultChannelVersion
	}
	c.clientVersion = ClientVersion(c.channelVersion)
	if c.longPollTimeout == 0 {
		c.longPollTimeout = DefaultLongPollTimeout
	}
	if c.apiTimeout == 0 {
		c.apiTimeout = DefaultAPITimeout
	}
	if c.logger == nil {
		c.logger = nopLogger{}
	}
	return c
}

// Restore returns a Client primed with previously saved credentials so it
// can immediately resume polling and sending without re-binding.
func Restore(creds Credentials, opts Options) *Client {
	c := New(opts)
	c.SetCredentials(creds)
	return c
}

// SetCredentials installs (or replaces) the per-account credentials. Called
// once on startup via Restore, and again when the QR bind flow completes.
func (c *Client) SetCredentials(creds Credentials) {
	if creds.BaseURL != "" {
		base := creds.BaseURL
		c.baseURL.Store(&base)
	}
	if creds.BotToken != "" {
		tok := creds.BotToken
		c.botToken.Store(&tok)
	}
}

// MessagingBaseURL returns the host the client will use for non-QR
// requests. Empty when no credentials have been installed yet.
func (c *Client) MessagingBaseURL() string {
	if p := c.baseURL.Load(); p != nil {
		return *p
	}
	return ""
}

// botTokenValue returns the current bearer token, or "" if unset.
func (c *Client) botTokenValue() string {
	if p := c.botToken.Load(); p != nil {
		return *p
	}
	return ""
}

// ChannelVersion returns the value the client advertises in BaseInfo and
// embeds in the iLink-App-ClientVersion header.
func (c *Client) ChannelVersion() string { return c.channelVersion }

// baseInfo builds the per-request metadata blob.
func (c *Client) baseInfo() BaseInfo {
	return BaseInfo{ChannelVersion: c.channelVersion}
}

// =============================================================================
// header construction
// =============================================================================

// commonHeaders returns the headers shared by GET and POST. The randomized
// X-WECHAT-UIN is intentionally added on POST only (matches upstream).
func (c *Client) commonHeaders() http.Header {
	h := http.Header{}
	h.Set("iLink-App-Id", c.appID)
	h.Set("iLink-App-ClientVersion", strconv.FormatUint(uint64(c.clientVersion), 10))
	return h
}

// postHeaders extends commonHeaders with content-type, auth, and the
// per-request randomized X-WECHAT-UIN. token may be empty (during bind).
func (c *Client) postHeaders(bodyLen int, token string) (http.Header, error) {
	h := c.commonHeaders()
	h.Set("Content-Type", "application/json")
	h.Set("AuthorizationType", "ilink_bot_token")
	h.Set("Content-Length", strconv.Itoa(bodyLen))
	uin, err := randomWechatUIN()
	if err != nil {
		return nil, fmt.Errorf("ilink: build X-WECHAT-UIN: %w", err)
	}
	h.Set("X-WECHAT-UIN", uin)
	if token != "" {
		h.Set("Authorization", "Bearer "+token)
	}
	return h, nil
}

// randomWechatUIN reproduces the upstream construction:
//
//	base64( decimal_string( uint32_be(crypto.randomBytes(4)) ) )
//
// The point is not entropy — it is byte-for-byte parity with the official
// plugin so server fingerprinting cannot easily distinguish us.
func randomWechatUIN() (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	n := binary.BigEndian.Uint32(b[:])
	dec := strconv.FormatUint(uint64(n), 10)
	return base64.StdEncoding.EncodeToString([]byte(dec)), nil
}

// =============================================================================
// HTTP wrappers
// =============================================================================

// ensureTrailingSlash mirrors the upstream behavior so url.URL.ResolveReference
// concatenates the endpoint cleanly.
func ensureTrailingSlash(s string) string {
	if strings.HasSuffix(s, "/") {
		return s
	}
	return s + "/"
}

// resolve produces an absolute URL string from a base + relative endpoint.
func resolve(baseURL, endpoint string) (string, error) {
	base, err := url.Parse(ensureTrailingSlash(baseURL))
	if err != nil {
		return "", fmt.Errorf("ilink: parse base url %q: %w", baseURL, err)
	}
	rel, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("ilink: parse endpoint %q: %w", endpoint, err)
	}
	return base.ResolveReference(rel).String(), nil
}

// httpDoOptions holds the per-call knobs for doHTTP.
type httpDoOptions struct {
	method     string
	baseURL    string
	endpoint   string
	body       []byte
	token      string
	timeout    time.Duration
	label      string
	withAuth   bool // include Authorization header (POST only)
}

// doHTTP executes a request, applying header construction, the per-call
// timeout, and HTTP-status-to-error mapping. Returns the raw response body.
func (c *Client) doHTTP(ctx context.Context, opts httpDoOptions) ([]byte, error) {
	urlStr, err := resolve(opts.baseURL, opts.endpoint)
	if err != nil {
		return nil, err
	}

	if opts.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, opts.timeout)
		defer cancel()
	}

	var bodyReader io.Reader
	if len(opts.body) > 0 {
		bodyReader = bytes.NewReader(opts.body)
	}
	req, err := http.NewRequestWithContext(ctx, opts.method, urlStr, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("ilink: build %s request: %w", opts.label, err)
	}

	if opts.method == http.MethodPost {
		hdrs, err := c.postHeaders(len(opts.body), opts.token)
		if err != nil {
			return nil, err
		}
		req.Header = hdrs
	} else {
		req.Header = c.commonHeaders()
	}

	c.logger.Debug("ilink request", "label", opts.label, "method", opts.method, "url", urlStr)

	resp, err := c.httpc.Do(req)
	if err != nil {
		// Distinguish a context-deadline cancellation (long-poll timeout)
		// from a real network failure: callers want to handle them
		// differently.
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, &TimeoutError{Label: opts.label, Cause: err}
		}
		return nil, fmt.Errorf("ilink: %s transport error: %w", opts.label, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("ilink: %s read body: %w", opts.label, err)
	}
	c.logger.Debug("ilink response", "label", opts.label, "status", resp.StatusCode, "bytes", len(raw))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &HTTPError{Label: opts.label, Status: resp.StatusCode, Body: string(raw)}
	}
	return raw, nil
}

// postJSON marshals body, executes a POST, unmarshals the response into out.
func (c *Client) postJSON(ctx context.Context, baseURL, endpoint string, body any, out any, timeout time.Duration, label string) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("ilink: marshal %s: %w", label, err)
	}
	respBytes, err := c.doHTTP(ctx, httpDoOptions{
		method:   http.MethodPost,
		baseURL:  baseURL,
		endpoint: endpoint,
		body:     raw,
		token:    c.botTokenValue(),
		timeout:  timeout,
		label:    label,
	})
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBytes, out); err != nil {
		return fmt.Errorf("ilink: unmarshal %s: %w", label, err)
	}
	return nil
}

// getJSON executes a GET (no auth headers) and unmarshals the response.
func (c *Client) getJSON(ctx context.Context, baseURL, endpoint string, out any, timeout time.Duration, label string) error {
	respBytes, err := c.doHTTP(ctx, httpDoOptions{
		method:   http.MethodGet,
		baseURL:  baseURL,
		endpoint: endpoint,
		timeout:  timeout,
		label:    label,
	})
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBytes, out); err != nil {
		return fmt.Errorf("ilink: unmarshal %s: %w", label, err)
	}
	return nil
}
