package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostproto"
)

// feishuRegistrationServer replays a scripted device-authorization
// exchange so the coordinator can be driven end to end without touching
// the real platform.
func feishuRegistrationServer(t *testing.T, pollBodies []string) *httptest.Server {
	t.Helper()
	var mu sync.Mutex
	polls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		var body string
		if r.PostForm.Get("action") == "begin" {
			body = `{"device_code":"dev-1","verification_uri_complete":"https://example.test/app?code=A",` +
				`"interval":1,"expires_in":600}`
		} else {
			mu.Lock()
			idx := polls
			if idx >= len(pollBodies) {
				idx = len(pollBodies) - 1
			}
			polls++
			mu.Unlock()
			body = pollBodies[idx]
		}
		if strings.Contains(body, `"error"`) {
			w.WriteHeader(http.StatusBadRequest)
		}
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// collectFrames decodes the NDJSON the coordinator wrote.
func collectFrames(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var frame map[string]any
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			t.Fatalf("decode %q: %v", line, err)
		}
		out = append(out, frame)
	}
	return out
}

func framesOfType(frames []map[string]any, typ string) []map[string]any {
	var out []map[string]any
	for _, f := range frames {
		if f["type"] == typ {
			out = append(out, f)
		}
	}
	return out
}

// waitFor polls cond until it holds or the deadline passes. The
// coordinator runs its flow on its own goroutine, so the test needs a
// synchronization point that is not a fixed sleep.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met within 5s")
}

func TestFeishuBindCoordinator_EmitsQRAndCredentials(t *testing.T) {
	srv := feishuRegistrationServer(t, []string{
		`{"error":"authorization_pending"}`,
		`{"client_id":"cli_new","client_secret":"sec-new","user_info":{"open_id":"ou_1","tenant_brand":"feishu"}}`,
	})

	var mu sync.Mutex
	buf := &bytes.Buffer{}
	cfg := &hostproto.FeishuConfig{AccountsDomain: srv.URL}
	rebuild := make(chan struct{}, 1)
	c := newFeishuBindCoordinator(
		cfg,
		hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {},
		rebuild,
	)

	c.Start(context.Background())
	select {
	case <-rebuild:
	case <-time.After(10 * time.Second):
		t.Fatal("registration did not finish")
	}

	mu.Lock()
	frames := collectFrames(t, buf)
	mu.Unlock()

	qr := framesOfType(frames, hostproto.TypeFeishuQR)
	if len(qr) != 1 {
		t.Fatalf("feishu_qr frames = %d", len(qr))
	}
	url, _ := qr[0]["url"].(string)
	if !strings.Contains(url, "addons=") || !strings.Contains(url, "createOnly=true") {
		t.Fatalf("qr url misses the pre-filled config: %q", url)
	}

	bound := framesOfType(frames, hostproto.TypeFeishuBound)
	if len(bound) != 1 {
		t.Fatalf("feishu_bound frames = %d", len(bound))
	}
	if bound[0]["appId"] != "cli_new" || bound[0]["appSecret"] != "sec-new" {
		t.Fatalf("bound frame = %+v", bound[0])
	}

	status := framesOfType(frames, hostproto.TypeFeishuBindStatus)
	if len(status) != 1 || status[0]["status"] != hostproto.WechatBindStatusConfirmed {
		t.Fatalf("status frames = %+v", status)
	}

	// The credentials must also land on the shared config so the rebuilt
	// transport starts with them.
	if cfg.AppID != "cli_new" || cfg.AppSecret != "sec-new" {
		t.Fatalf("cfg = %+v", cfg)
	}
}

// A Lark tenant's app lives on the international API host; the coordinator
// pins it so the rebuild does not call open.feishu.cn.
func TestFeishuBindCoordinator_PinsLarkBaseURL(t *testing.T) {
	srv := feishuRegistrationServer(t, []string{
		`{"client_id":"cli_l","client_secret":"s","user_info":{"tenant_brand":"lark"}}`,
	})
	var mu sync.Mutex
	buf := &bytes.Buffer{}
	cfg := &hostproto.FeishuConfig{AccountsDomain: srv.URL}
	rebuild := make(chan struct{}, 1)
	c := newFeishuBindCoordinator(cfg, hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {}, rebuild)

	c.Start(context.Background())
	select {
	case <-rebuild:
	case <-time.After(10 * time.Second):
		t.Fatal("registration did not finish")
	}
	if cfg.BaseURL != larkOpenBaseURL {
		t.Fatalf("BaseURL = %q, want %q", cfg.BaseURL, larkOpenBaseURL)
	}
}

func TestFeishuBindCoordinator_DeniedReportsFailure(t *testing.T) {
	srv := feishuRegistrationServer(t, []string{`{"error":"access_denied","error_description":"no"}`})
	var mu sync.Mutex
	buf := &bytes.Buffer{}
	cfg := &hostproto.FeishuConfig{AccountsDomain: srv.URL}
	c := newFeishuBindCoordinator(cfg, hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {}, make(chan struct{}, 1))

	c.Start(context.Background())
	waitFor(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return strings.Contains(buf.String(), hostproto.TypeFeishuBindStatus)
	})

	mu.Lock()
	status := framesOfType(collectFrames(t, buf), hostproto.TypeFeishuBindStatus)
	mu.Unlock()
	if len(status) != 1 || status[0]["status"] != hostproto.WechatBindStatusFailed {
		t.Fatalf("status frames = %+v", status)
	}
	if cfg.AppID != "" {
		t.Fatalf("denied registration left credentials: %+v", cfg)
	}
}

// LogoutAndClear drops the in-memory credentials (the parent owns the
// persisted copy) and announces the unbind.
func TestFeishuBindCoordinator_LogoutClearsCredentials(t *testing.T) {
	var mu sync.Mutex
	buf := &bytes.Buffer{}
	cfg := &hostproto.FeishuConfig{AppID: "cli_x", AppSecret: "s"}
	c := newFeishuBindCoordinator(cfg, hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {}, make(chan struct{}, 1))

	if err := c.LogoutAndClear("user logout"); err != nil {
		t.Fatalf("LogoutAndClear: %v", err)
	}
	if cfg.AppID != "" || cfg.AppSecret != "" {
		t.Fatalf("cfg still holds credentials: %+v", cfg)
	}
	mu.Lock()
	unbound := framesOfType(collectFrames(t, buf), hostproto.TypeFeishuUnbound)
	mu.Unlock()
	if len(unbound) != 1 || unbound[0]["reason"] != "user logout" {
		t.Fatalf("unbound frames = %+v", unbound)
	}
}

// A config_update replaces the spec wholesale. The coordinator is kept
// (an in-flight scan must survive) but has to follow the new slot, or the
// credentials a scan produces land in a struct nothing builds from — which
// looks like "scan succeeded, bridge still waiting to bind".
func TestFeishuBindCoordinator_AdoptFollowsTheLiveSpec(t *testing.T) {
	var mu sync.Mutex
	buf := &bytes.Buffer{}
	stale := &hostproto.FeishuConfig{}
	c := newFeishuBindCoordinator(stale, hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {}, make(chan struct{}, 1))

	live := &hostproto.FeishuConfig{}
	c.Adopt(&buildSpec{Feishu: live})

	if err := c.LogoutAndClear("switch"); err != nil {
		t.Fatalf("LogoutAndClear: %v", err)
	}
	if c.cfg != live {
		t.Fatal("coordinator still points at the superseded config slot")
	}
}

// The one-click flow cannot set the event delivery mode on the URL, so the
// coordinator states it afterwards — but only for an app this process just
// registered, never for credentials the user typed in themselves.
func TestFeishuBindCoordinator_SyncAfterBindOnlyForItsOwnRegistration(t *testing.T) {
	var mu sync.Mutex
	buf := &bytes.Buffer{}
	cfg := &hostproto.FeishuConfig{AppID: "cli_typed", AppSecret: "sec"}
	c := newFeishuBindCoordinator(cfg, hostproto.NewWriter(&lockedWriter{mu: &mu, w: buf}),
		func(string, string, map[string]any) {}, make(chan struct{}, 1))

	// No registration happened in this process: nothing to repair, and no
	// network call worth attempting.
	c.SyncAfterBind(context.Background())
	mu.Lock()
	quiet := buf.Len() == 0
	mu.Unlock()
	if !quiet {
		t.Fatalf("hand-configured credentials triggered a sync: %s", buf.String())
	}
}

// The registration flow selects feishu whenever the slot is present, so a
// bound app can be re-scanned without switching channels first.
func TestBindCoordinatorKind_Feishu(t *testing.T) {
	if got := bindCoordinatorKind(&buildSpec{Feishu: &hostproto.FeishuConfig{}}); got != "feishu" {
		t.Fatalf("kind = %q, want feishu", got)
	}
	if got := bindCoordinatorKind(&buildSpec{Feishu: &hostproto.FeishuConfig{AppID: "cli_x", AppSecret: "s"}}); got != "feishu" {
		t.Fatalf("kind for a bound app = %q, want feishu", got)
	}
}

func TestFeishuBindFrames_RoutedToActiveChannelOnly(t *testing.T) {
	cases := []struct {
		name      string
		coordKind string
		frame     any
		want      frameAction
	}{
		{"bind on feishu", "feishu", &hostproto.FeishuBindStartFrame{}, frameAction{startBind: true}},
		{"logout on feishu", "feishu", &hostproto.FeishuLogoutFrame{}, frameAction{logout: true}},
		{"feishu frame on signal", "signal", &hostproto.FeishuBindStartFrame{}, frameAction{}},
		{"feishu frame with no coordinator", "", &hostproto.FeishuLogoutFrame{}, frameAction{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &hostRuntime{
				out:     hostproto.NewWriter(io.Discard),
				emitLog: func(string, string, map[string]any) {},
			}
			if tc.coordKind != "" {
				h.coordKind = tc.coordKind
				h.coord = &stubBindCoordinator{}
			}
			if got := h.handleFrame(tc.frame); got != tc.want {
				t.Fatalf("action = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// lockedWriter serializes writes from the coordinator goroutine with the
// test's reads of the same buffer.
type lockedWriter struct {
	mu *sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
