package feishu

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// One-click app registration ("扫码接入").
//
// The Feishu Open Platform exposes app creation as an OAuth 2.0 Device
// Authorization Grant (RFC 8628): we ask for a device code, render the
// returned verification URL as a QR code, and poll until the user has
// scanned it and confirmed the app on the platform page. What comes back
// is a freshly minted App ID + App Secret with the bot capability and the
// scopes/events we declared already enabled — replacing the manual
// "create app → toggle bot → tick scopes → subscribe events → publish →
// copy two secrets" walk through the developer console.
//
// The wire format is not covered by the REST reference; the official
// larksuite SDKs (`registerApp` in @larksuiteoapi/node-sdk) are the
// contract we mirror here, parameter names included.

const (
	// AccountsDomainFeishu is the default authorization host (mainland
	// Feishu). Only the host part, matching the SDK's `domain` option.
	AccountsDomainFeishu = "accounts.feishu.cn"
	// AccountsDomainLark is the international counterpart. The poll
	// response tells us to switch here when the scanning user turns out
	// to belong to a Lark tenant.
	AccountsDomainLark = "accounts.larksuite.com"

	registrationPath = "/oauth/v1/app/registration"

	// archetype selects the platform's app template; PersonalAgent is the
	// bot-shaped one the SDK uses. auth_method asks for a client secret
	// (rather than a key pair), which is what our transport authenticates
	// with.
	registrationArchetype  = "PersonalAgent"
	registrationAuthMethod = "client_secret"

	// Defaults applied when the platform omits them from the begin
	// response, mirroring the SDK.
	defaultRegisterInterval = 5 * time.Second
	defaultRegisterExpire   = 10 * time.Minute
	// slowDownStep is the extra delay RFC 8628 asks the client to add to
	// its polling interval on every `slow_down`.
	slowDownStep = 5 * time.Second

	registerHTTPTimeout = 30 * time.Second
)

// Registration status values passed to RegisterOptions.OnStatus. They
// describe polling progress only; success and failure are the return
// values of Register.
const (
	RegisterStatusPolling        = "polling"
	RegisterStatusSlowDown       = "slow_down"
	RegisterStatusDomainSwitched = "domain_switched"
)

// RegisterError is a terminal error reported by the platform. Code is the
// RFC 8628 / platform error code (`access_denied`, `expired_token`, ...).
type RegisterError struct {
	Code        string
	Description string
}

func (e *RegisterError) Error() string {
	if e.Description == "" {
		return e.Code
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Description)
}

// Registration error codes worth branching on.
const (
	RegisterErrAccessDenied = "access_denied"
	RegisterErrExpiredToken = "expired_token"
)

// RegisterScopes lists permission scopes to pre-fill on the confirm page.
type RegisterScopes struct {
	// Tenant holds app-identity scopes, e.g. "im:message:send_as_bot".
	Tenant []string `json:"tenant,omitempty"`
	// User holds user-identity scopes.
	User []string `json:"user,omitempty"`
}

// RegisterEventItems lists event subscriptions by identity.
type RegisterEventItems struct {
	Tenant []string `json:"tenant,omitempty"`
	User   []string `json:"user,omitempty"`
}

// RegisterEvents wraps the event items in the shape the confirm page
// expects (mirrors the app manifest).
type RegisterEvents struct {
	Items *RegisterEventItems `json:"items,omitempty"`
}

// RegisterCallbacks lists card callbacks, e.g. "card.action.trigger".
type RegisterCallbacks struct {
	Items []string `json:"items,omitempty"`
}

// RegisterAddons is the incremental app configuration pre-filled into the
// page the user confirms after scanning.
//
// Only these public manifest fields may travel on the URL. Sensitive
// configuration (event subscription mode, request URL, encrypt key) is not
// accepted here; it belongs to the "update application config" OpenAPI.
type RegisterAddons struct {
	// Preset selects the template base. Nil / true keeps the platform's
	// default template and layers the declared items on top; false drops
	// it for the minimal base (bot capability only, no business scopes)
	// and shows exactly what we declare.
	Preset    *bool              `json:"preset,omitempty"`
	Scopes    *RegisterScopes    `json:"scopes,omitempty"`
	Events    *RegisterEvents    `json:"events,omitempty"`
	Callbacks *RegisterCallbacks `json:"callbacks,omitempty"`
}

// RegisterAppPreset pre-fills the app's identity on the creation page. The
// user can still edit every field before confirming.
type RegisterAppPreset struct {
	// Name supports the "{user}" placeholder (the scanning user's name).
	Name string
	// Desc supports the "{user}" placeholder.
	Desc string
	// Avatar is a publicly reachable image URL. At most avatarMaxCount
	// entries; the first is selected by default.
	Avatar []string
}

const avatarMaxCount = 6

// RegisterQRCode is what the caller renders for the user to scan.
type RegisterQRCode struct {
	// URL is the verification link. Render it as a QR code, or offer it
	// as a plain link for a user already on the same device.
	URL string
	// ExpireIn is the link's lifetime in seconds.
	ExpireIn int
}

// RegisterOptions configures Register.
type RegisterOptions struct {
	// Domain overrides the authorization host, normally bare (matching
	// the SDK's `domain` option); an explicit scheme is honored so a test
	// server can be addressed over plain HTTP. Empty uses
	// AccountsDomainFeishu.
	Domain string
	// LarkDomain overrides the host we switch to when the scanning user
	// belongs to a Lark tenant. Same form as Domain. Empty falls back to
	// Domain when that was pinned explicitly — a caller that named its
	// authorization host does not want the flow wandering off to another
	// one — and to AccountsDomainLark otherwise.
	LarkDomain string
	// Source is a free-form origin tag carried on the QR URL.
	Source string
	// Addons pre-fills scopes / events / callbacks on the confirm page.
	Addons *RegisterAddons
	// AppPreset pre-fills the app's name / description / avatar.
	AppPreset *RegisterAppPreset
	// CreateOnly hides the "pick an existing app" entry on the landing
	// page, so a user cannot accidentally rewrite another app's config.
	CreateOnly bool
	// AppID (cli_...) turns the flow into an update of that existing app:
	// the confirm page shows the diff the addons bring. Ignored when
	// CreateOnly is set.
	AppID string
	// OnQRCode is called once, as soon as the verification link exists.
	// Required.
	OnQRCode func(RegisterQRCode)
	// OnStatus reports polling progress (RegisterStatus* values).
	OnStatus func(status string)
	// HTTPClient overrides the client used for the two endpoints. Tests
	// inject one pointed at a local server.
	HTTPClient *http.Client

	// Test seams. The platform expresses its polling cadence in whole
	// seconds, which would make the loop's tests wait for real ones.
	pollInterval  time.Duration
	slowDownDelta time.Duration
}

// RegisterResult carries the credentials the platform minted.
type RegisterResult struct {
	AppID     string
	AppSecret string
	// TenantBrand is "feishu" or "lark" when the platform reported it.
	TenantBrand string
	// OpenID identifies the user who scanned, when reported.
	OpenID string
}

type registerBeginResponse struct {
	DeviceCode              string `json:"device_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	UserCode                string `json:"user_code"`
	Interval                int    `json:"interval"`
	ExpiresIn               int    `json:"expires_in"`
	Error                   string `json:"error"`
	ErrorDescription        string `json:"error_description"`
}

type registerUserInfo struct {
	OpenID      string `json:"open_id"`
	TenantBrand string `json:"tenant_brand"`
}

type registerPollResponse struct {
	ClientID         string            `json:"client_id"`
	ClientSecret     string            `json:"client_secret"`
	UserInfo         *registerUserInfo `json:"user_info"`
	Error            string            `json:"error"`
	ErrorDescription string            `json:"error_description"`
}

// Register drives the device-authorization flow to completion.
//
// It blocks until the user confirms (returning the credentials), the
// platform reports a terminal error, the link expires, or ctx is
// canceled. Cancellation surfaces as ctx.Err().
func Register(ctx context.Context, opts RegisterOptions) (*RegisterResult, error) {
	if opts.OnQRCode == nil {
		return nil, errors.New("feishu register: OnQRCode is required")
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: registerHTTPTimeout}
	}
	baseURL := authBaseURL(firstNonEmpty(opts.Domain, AccountsDomainFeishu))
	larkBaseURL := authBaseURL(firstNonEmpty(opts.LarkDomain, opts.Domain, AccountsDomainLark))

	var begin registerBeginResponse
	if err := postRegistration(ctx, client, baseURL, url.Values{
		"action":            {"begin"},
		"archetype":         {registrationArchetype},
		"auth_method":       {registrationAuthMethod},
		"request_user_info": {"open_id"},
	}, &begin); err != nil {
		return nil, err
	}
	if begin.Error != "" {
		return nil, &RegisterError{Code: begin.Error, Description: begin.ErrorDescription}
	}
	if begin.DeviceCode == "" || begin.VerificationURIComplete == "" {
		return nil, errors.New("feishu register: platform returned no device code")
	}

	qrURL, err := buildRegisterQRURL(begin.VerificationURIComplete, opts)
	if err != nil {
		return nil, err
	}
	expiresIn := begin.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = int(defaultRegisterExpire / time.Second)
	}
	opts.OnQRCode(RegisterQRCode{URL: qrURL, ExpireIn: expiresIn})

	interval := intervalOrDefault(begin.Interval)
	if opts.pollInterval > 0 {
		interval = opts.pollInterval
	}
	slowDown := slowDownStep
	if opts.slowDownDelta > 0 {
		slowDown = opts.slowDownDelta
	}
	return pollRegistration(ctx, client, pollParams{
		baseURL:     baseURL,
		larkBaseURL: larkBaseURL,
		deviceCode:  begin.DeviceCode,
		interval:    interval,
		slowDown:    slowDown,
		expiresIn:   time.Duration(expiresIn) * time.Second,
		onStatus:    opts.OnStatus,
	})
}

type pollParams struct {
	baseURL     string
	larkBaseURL string
	deviceCode  string
	interval    time.Duration
	slowDown    time.Duration
	expiresIn   time.Duration
	onStatus    func(string)
}

func pollRegistration(ctx context.Context, client *http.Client, p pollParams) (*RegisterResult, error) {
	deadline := time.Now().Add(p.expiresIn)
	baseURL := p.baseURL
	interval := p.interval
	domainSwitched := false
	emit := func(status string) {
		if p.onStatus != nil {
			p.onStatus(status)
		}
	}

	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}

		var res registerPollResponse
		if err := postRegistration(ctx, client, baseURL, url.Values{
			"action":      {"poll"},
			"device_code": {p.deviceCode},
		}, &res); err != nil {
			return nil, err
		}

		// A Lark tenant is served by a different authorization host; the
		// platform tells us which one by echoing the brand back. Switch
		// once and re-poll immediately.
		if res.UserInfo != nil && res.UserInfo.TenantBrand == "lark" && !domainSwitched {
			baseURL = p.larkBaseURL
			domainSwitched = true
			emit(RegisterStatusDomainSwitched)
			timer.Reset(0)
			continue
		}

		if res.ClientID != "" && res.ClientSecret != "" {
			out := &RegisterResult{AppID: res.ClientID, AppSecret: res.ClientSecret}
			if res.UserInfo != nil {
				out.OpenID = res.UserInfo.OpenID
				out.TenantBrand = res.UserInfo.TenantBrand
			}
			return out, nil
		}

		switch res.Error {
		case "authorization_pending", "":
			emit(RegisterStatusPolling)
		case "slow_down":
			interval += p.slowDown
			emit(RegisterStatusSlowDown)
		default:
			return nil, &RegisterError{Code: res.Error, Description: res.ErrorDescription}
		}

		if time.Now().Add(interval).After(deadline) {
			return nil, &RegisterError{Code: RegisterErrExpiredToken, Description: "二维码已过期，请重新扫码"}
		}
		timer.Reset(interval)
	}
}

// postRegistration performs one form-encoded call against the
// registration endpoint. RFC 8628 pending/slow_down responses arrive with
// HTTP 400 and a JSON body, so a 4xx with a parseable body is decoded
// rather than treated as a transport failure.
func postRegistration(ctx context.Context, client *http.Client, baseURL string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+registrationPath, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("feishu register: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("feishu register: %s: %w", form.Get("action"), err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("feishu register: read response: %w", err)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("feishu register: %s: unexpected response (HTTP %d)", form.Get("action"), resp.StatusCode)
	}
	return nil
}

// buildRegisterQRURL decorates the platform's verification link with the
// origin tag and the pre-filled app configuration.
func buildRegisterQRURL(verificationURI string, opts RegisterOptions) (string, error) {
	u, err := url.Parse(verificationURI)
	if err != nil {
		return "", fmt.Errorf("feishu register: parse verification uri: %w", err)
	}
	q := u.Query()
	q.Set("from", "sdk")
	q.Set("tp", "sdk")
	if opts.Source != "" {
		q.Set("source", opts.Source)
	}
	if p := opts.AppPreset; p != nil {
		if len(p.Avatar) > avatarMaxCount {
			return "", fmt.Errorf("feishu register: at most %d avatars, got %d", avatarMaxCount, len(p.Avatar))
		}
		for _, avatar := range p.Avatar {
			if avatar != "" {
				q.Add("avatar", avatar)
			}
		}
		if p.Name != "" {
			q.Set("name", p.Name)
		}
		if p.Desc != "" {
			q.Set("desc", p.Desc)
		}
	}
	if opts.Addons != nil {
		encoded, err := encodeRegisterAddons(opts.Addons)
		if err != nil {
			return "", err
		}
		q.Set("addons", encoded)
	}
	// The landing page only honors the literal "true"; anything else
	// reads as absent.
	if opts.CreateOnly {
		q.Set("createOnly", "true")
	}
	// createOnly wins on the page when both are present, so passing them
	// through together is safe.
	if opts.AppID != "" {
		q.Set("clientID", opts.AppID)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// encodeRegisterAddons serializes the addons into the URL-safe string the
// confirm page expects. The pipeline is fixed by the platform:
// JSON → gzip → base64 → URL-safe alphabet → strip padding.
func encodeRegisterAddons(addons *RegisterAddons) (string, error) {
	data, err := json.Marshal(addons)
	if err != nil {
		return "", fmt.Errorf("feishu register: marshal addons: %w", err)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		return "", fmt.Errorf("feishu register: gzip addons: %w", err)
	}
	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("feishu register: gzip addons: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf.Bytes()), nil
}

// authBaseURL turns a configured authorization host into a base URL,
// defaulting to https for the bare hosts the platform documents.
func authBaseURL(domain string) string {
	if strings.Contains(domain, "://") {
		return strings.TrimSuffix(domain, "/")
	}
	return "https://" + domain
}

func intervalOrDefault(seconds int) time.Duration {
	if seconds <= 0 {
		return defaultRegisterInterval
	}
	return time.Duration(seconds) * time.Second
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
