package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type appConfigStub struct {
	mu          sync.Mutex
	tokenBody   string
	configBody  string
	configCalls int
	lastPatch   map[string]any
	lastAuth    string
}

func (s *appConfigStub) server(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(tenantTokenPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, s.tokenBody)
	})
	mux.HandleFunc("/open-apis/application/v7/applications/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/config") || r.Method != http.MethodPatch {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.configCalls++
		s.lastAuth = r.Header.Get("Authorization")
		_ = json.Unmarshal(body, &s.lastPatch)
		s.mu.Unlock()
		_, _ = io.WriteString(w, s.configBody)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// The whole point of this call: state that events go over the long
// connection and add the one the bridge lives on.
func TestEnsureWebsocketEvents_SubscribesOverTheLongConnection(t *testing.T) {
	stub := &appConfigStub{
		tokenBody:  `{"code":0,"msg":"ok","tenant_access_token":"t-abc","expire":7200}`,
		configBody: `{"code":0,"msg":"success"}`,
	}
	srv := stub.server(t)

	err := EnsureWebsocketEvents(context.Background(), AppConfigOptions{
		AppID:      "cli_abc",
		AppSecret:  "sec",
		Domain:     srv.URL,
		Events:     []string{"im.message.receive_v1"},
		HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("EnsureWebsocketEvents: %v", err)
	}

	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.configCalls != 1 {
		t.Fatalf("config calls = %d", stub.configCalls)
	}
	if stub.lastAuth != "Bearer t-abc" {
		t.Fatalf("authorization = %q", stub.lastAuth)
	}
	event, ok := stub.lastPatch["event"].(map[string]any)
	if !ok {
		t.Fatalf("patch body = %+v", stub.lastPatch)
	}
	if event["subscription_type"] != subscriptionTypeWebsocket {
		t.Fatalf("subscription_type = %v", event["subscription_type"])
	}
	added, _ := event["add_events"].([]any)
	if len(added) != 1 || added[0] != "im.message.receive_v1" {
		t.Fatalf("add_events = %v", event["add_events"])
	}
}

// A refused patch must surface the platform's own code and message: it is
// what tells the user whether to grant a scope or configure by hand.
func TestEnsureWebsocketEvents_SurfacesPlatformRefusal(t *testing.T) {
	stub := &appConfigStub{
		tokenBody:  `{"code":0,"msg":"ok","tenant_access_token":"t-abc"}`,
		configBody: `{"code":99991672,"msg":"no permission"}`,
	}
	srv := stub.server(t)

	err := EnsureWebsocketEvents(context.Background(), AppConfigOptions{
		AppID:      "cli_abc",
		AppSecret:  "sec",
		Domain:     srv.URL,
		Events:     []string{"im.message.receive_v1"},
		HTTPClient: srv.Client(),
	})
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want *APIError", err)
	}
	if apiErr.Code != 99991672 || apiErr.Msg != "no permission" {
		t.Fatalf("apiErr = %+v", apiErr)
	}
}

func TestEnsureWebsocketEvents_BadCredentialsStopBeforePatching(t *testing.T) {
	stub := &appConfigStub{
		tokenBody:  `{"code":10003,"msg":"invalid app_secret"}`,
		configBody: `{"code":0}`,
	}
	srv := stub.server(t)

	err := EnsureWebsocketEvents(context.Background(), AppConfigOptions{
		AppID:      "cli_abc",
		AppSecret:  "wrong",
		Domain:     srv.URL,
		Events:     []string{"im.message.receive_v1"},
		HTTPClient: srv.Client(),
	})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != 10003 {
		t.Fatalf("err = %v", err)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.configCalls != 0 {
		t.Fatalf("patched despite a failed token exchange (calls = %d)", stub.configCalls)
	}
}

func TestEnsureWebsocketEvents_RequiresCredentials(t *testing.T) {
	if err := EnsureWebsocketEvents(context.Background(), AppConfigOptions{}); err == nil {
		t.Fatal("expected an error without credentials")
	}
}
