package feishu

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// registrationStub is a stand-in for the platform's device-authorization
// endpoint: it records the form values it saw and replays a scripted list
// of poll responses.
type registrationStub struct {
	mu    sync.Mutex
	forms []url.Values
	polls []string // JSON bodies, one per poll call; the last repeats
	begin string
}

func (s *registrationStub) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(registrationPath, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		s.forms = append(s.forms, r.PostForm)
		action := r.PostForm.Get("action")
		var body string
		switch action {
		case "begin":
			body = s.begin
		default:
			polls := 0
			for _, f := range s.forms {
				if f.Get("action") == "poll" {
					polls++
				}
			}
			idx := polls - 1
			if idx >= len(s.polls) {
				idx = len(s.polls) - 1
			}
			body = s.polls[idx]
		}
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		// RFC 8628 delivers pending / slow_down with HTTP 400.
		if strings.Contains(body, `"error"`) {
			w.WriteHeader(http.StatusBadRequest)
		}
		_, _ = io.WriteString(w, body)
	})
	return mux
}

func (s *registrationStub) formsFor(action string) []url.Values {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []url.Values
	for _, f := range s.forms {
		if f.Get("action") == action {
			out = append(out, f)
		}
	}
	return out
}

// newStubbedRegister wires a stub server and returns options pointed at
// it, with the polling cadence collapsed so the loop does not wait real
// seconds.
func newStubbedRegister(t *testing.T, stub *registrationStub) (RegisterOptions, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(stub.handler())
	t.Cleanup(srv.Close)
	return RegisterOptions{
		Domain:        srv.URL,
		LarkDomain:    srv.URL,
		HTTPClient:    srv.Client(),
		OnQRCode:      func(RegisterQRCode) {},
		pollInterval:  time.Millisecond,
		slowDownDelta: 20 * time.Millisecond,
	}, srv
}

func beginBody(verificationURI string) string {
	return `{"device_code":"dev-1","verification_uri":"https://example.test/app","verification_uri_complete":"` +
		verificationURI + `","user_code":"ABCD","interval":0,"expires_in":600}`
}

func TestRegister_PollsUntilConfirmed(t *testing.T) {
	stub := &registrationStub{
		begin: beginBody("https://example.test/app?code=ABCD"),
		polls: []string{
			`{"error":"authorization_pending","error_description":"waiting"}`,
			`{"client_id":"cli_abc","client_secret":"sec","user_info":{"open_id":"ou_1","tenant_brand":"feishu"}}`,
		},
	}
	opts, _ := newStubbedRegister(t, stub)

	var qr RegisterQRCode
	var statuses []string
	opts.OnQRCode = func(info RegisterQRCode) { qr = info }
	opts.OnStatus = func(status string) { statuses = append(statuses, status) }

	res, err := Register(context.Background(), opts)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if res.AppID != "cli_abc" || res.AppSecret != "sec" {
		t.Fatalf("credentials = %+v", res)
	}
	if res.OpenID != "ou_1" || res.TenantBrand != "feishu" {
		t.Fatalf("user info = %+v", res)
	}
	if qr.ExpireIn != 600 || !strings.Contains(qr.URL, "code=ABCD") {
		t.Fatalf("qr = %+v", qr)
	}
	if len(statuses) == 0 || statuses[0] != RegisterStatusPolling {
		t.Fatalf("statuses = %v", statuses)
	}

	begins := stub.formsFor("begin")
	if len(begins) != 1 {
		t.Fatalf("begin calls = %d", len(begins))
	}
	if got := begins[0].Get("archetype"); got != registrationArchetype {
		t.Fatalf("archetype = %q", got)
	}
	if got := begins[0].Get("auth_method"); got != registrationAuthMethod {
		t.Fatalf("auth_method = %q", got)
	}
	polls := stub.formsFor("poll")
	if len(polls) != 2 || polls[0].Get("device_code") != "dev-1" {
		t.Fatalf("polls = %v", polls)
	}
}

func TestRegister_SlowDownBacksOff(t *testing.T) {
	stub := &registrationStub{
		begin: beginBody("https://example.test/app"),
		polls: []string{
			`{"error":"slow_down"}`,
			`{"client_id":"cli_abc","client_secret":"sec"}`,
		},
	}
	opts, _ := newStubbedRegister(t, stub)
	var statuses []string
	opts.OnStatus = func(status string) { statuses = append(statuses, status) }

	start := time.Now()
	if _, err := Register(context.Background(), opts); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if len(statuses) == 0 || statuses[0] != RegisterStatusSlowDown {
		t.Fatalf("statuses = %v", statuses)
	}
	// One slow_down means the second poll waits interval + one step.
	if elapsed := time.Since(start); elapsed < opts.slowDownDelta {
		t.Fatalf("did not back off: %s", elapsed)
	}
}

func TestRegister_TerminalErrors(t *testing.T) {
	cases := []struct {
		name string
		poll string
		want string
	}{
		{"denied", `{"error":"access_denied","error_description":"user said no"}`, RegisterErrAccessDenied},
		{"expired", `{"error":"expired_token","error_description":"too late"}`, RegisterErrExpiredToken},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &registrationStub{begin: beginBody("https://example.test/app"), polls: []string{tc.poll}}
			opts, _ := newStubbedRegister(t, stub)

			_, err := Register(context.Background(), opts)
			var regErr *RegisterError
			if !errors.As(err, &regErr) {
				t.Fatalf("err = %v, want *RegisterError", err)
			}
			if regErr.Code != tc.want {
				t.Fatalf("code = %q, want %q", regErr.Code, tc.want)
			}
		})
	}
}

// A Lark tenant is served by a different authorization host; the flow must
// switch once and keep polling rather than hand back a half-result.
func TestRegister_SwitchesToLarkDomain(t *testing.T) {
	stub := &registrationStub{
		begin: beginBody("https://example.test/app"),
		polls: []string{
			`{"user_info":{"tenant_brand":"lark"}}`,
			`{"client_id":"cli_lark","client_secret":"sec","user_info":{"tenant_brand":"lark"}}`,
		},
	}
	opts, _ := newStubbedRegister(t, stub)
	var statuses []string
	opts.OnStatus = func(status string) { statuses = append(statuses, status) }

	res, err := Register(context.Background(), opts)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if res.AppID != "cli_lark" || res.TenantBrand != "lark" {
		t.Fatalf("result = %+v", res)
	}
	if len(statuses) != 1 || statuses[0] != RegisterStatusDomainSwitched {
		t.Fatalf("statuses = %v", statuses)
	}
}

func TestRegister_ContextCancelStopsPolling(t *testing.T) {
	stub := &registrationStub{
		begin: beginBody("https://example.test/app"),
		polls: []string{`{"error":"authorization_pending"}`},
	}
	opts, _ := newStubbedRegister(t, stub)

	ctx, cancel := context.WithCancel(context.Background())
	opts.OnQRCode = func(RegisterQRCode) { cancel() }

	_, err := Register(ctx, opts)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestRegister_RequiresQRCallback(t *testing.T) {
	if _, err := Register(context.Background(), RegisterOptions{}); err == nil {
		t.Fatal("expected an error without OnQRCode")
	}
}

func TestBuildRegisterQRURL_CarriesPresetAndAddons(t *testing.T) {
	minimal := false
	raw, err := buildRegisterQRURL("https://example.test/app?code=ABCD", RegisterOptions{
		Source:     "vetta-im-gateway",
		CreateOnly: true,
		// createOnly wins on the landing page, but both may travel.
		AppID:     "cli_existing",
		AppPreset: &RegisterAppPreset{Name: "Vetta", Desc: "desc", Avatar: []string{"https://example.test/a.png"}},
		Addons: &RegisterAddons{
			Preset: &minimal,
			Scopes: &RegisterScopes{Tenant: []string{"im:message:send_as_bot"}},
			Events: &RegisterEvents{Items: &RegisterEventItems{Tenant: []string{"im.message.receive_v1"}}},
		},
	})
	if err != nil {
		t.Fatalf("buildRegisterQRURL: %v", err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	q := u.Query()
	for key, want := range map[string]string{
		"code":       "ABCD",
		"from":       "sdk",
		"tp":         "sdk",
		"source":     "vetta-im-gateway",
		"name":       "Vetta",
		"desc":       "desc",
		"avatar":     "https://example.test/a.png",
		"createOnly": "true",
		"clientID":   "cli_existing",
	} {
		if got := q.Get(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}

	// The addons payload must survive the platform's fixed pipeline:
	// JSON → gzip → URL-safe base64 without padding.
	encoded := q.Get("addons")
	if strings.ContainsAny(encoded, "+/=") {
		t.Fatalf("addons is not URL-safe: %q", encoded)
	}
	gz, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64: %v", err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		t.Fatalf("gzip: %v", err)
	}
	decoded, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	var back RegisterAddons
	if err := json.Unmarshal(decoded, &back); err != nil {
		t.Fatalf("json: %v", err)
	}
	if back.Preset == nil || *back.Preset {
		t.Fatalf("preset = %v, want false", back.Preset)
	}
	if back.Scopes == nil || len(back.Scopes.Tenant) != 1 {
		t.Fatalf("scopes = %+v", back.Scopes)
	}
	if back.Events == nil || back.Events.Items == nil || back.Events.Items.Tenant[0] != "im.message.receive_v1" {
		t.Fatalf("events = %+v", back.Events)
	}
}

func TestBuildRegisterQRURL_RejectsTooManyAvatars(t *testing.T) {
	avatars := make([]string, avatarMaxCount+1)
	for i := range avatars {
		avatars[i] = "https://example.test/a.png"
	}
	if _, err := buildRegisterQRURL("https://example.test/app", RegisterOptions{
		AppPreset: &RegisterAppPreset{Avatar: avatars},
	}); err == nil {
		t.Fatal("expected an error")
	}
}
