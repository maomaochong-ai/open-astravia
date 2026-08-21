package feishu

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Event subscription repair for scan-created apps.
//
// The one-click registration URL can carry scopes and an event list, but
// never the *delivery mode*: that is a sensitive field the confirm page
// refuses to take. An app that comes out of the scan can therefore end up
// with a bot that is installed and reachable — the transport happily opens
// its long connection and reports "online" — while the platform never
// pushes a single message to it, which reads to the user as a bot that
// ignores them.
//
// So once the credentials exist we state the subscription explicitly
// through the "update application config" OpenAPI: delivery over the long
// connection, plus the events the bridge needs.

const (
	// OpenBaseURLFeishu is the default API host for the mainland tenant.
	OpenBaseURLFeishu = "https://open.feishu.cn"

	tenantTokenPath = "/open-apis/auth/v3/tenant_access_token/internal"
	appConfigPath   = "/open-apis/application/v7/applications/%s/config"

	// subscriptionTypeWebsocket is the platform's name for "deliver events
	// over the long connection" — the mode this gateway speaks.
	subscriptionTypeWebsocket = "websocket"

	appConfigHTTPTimeout = 30 * time.Second
)

// APIError is a non-zero business code returned by an OpenAPI call.
type APIError struct {
	Code int
	Msg  string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("feishu openapi error %d: %s", e.Code, e.Msg)
}

// AppConfigOptions configures EnsureWebsocketEvents.
type AppConfigOptions struct {
	AppID     string
	AppSecret string
	// Domain overrides the API host (full base URL, e.g.
	// https://open.larksuite.com). Empty uses OpenBaseURLFeishu.
	Domain string
	// Events to add to the app's subscription, e.g.
	// "im.message.receive_v1". Already-subscribed events are accepted
	// again by the platform.
	Events []string
	// HTTPClient overrides the client used for both calls.
	HTTPClient *http.Client
}

type tenantTokenResponse struct {
	Code              int    `json:"code"`
	Msg               string `json:"msg"`
	TenantAccessToken string `json:"tenant_access_token"`
}

type baseResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

// EnsureWebsocketEvents points the app's event subscription at the long
// connection and adds the given events.
//
// Call it once the transport is connected: the platform validates that a
// long connection is actually live before it will accept the websocket
// subscription, so doing this before the transport starts fails.
func EnsureWebsocketEvents(ctx context.Context, opts AppConfigOptions) error {
	if opts.AppID == "" || opts.AppSecret == "" {
		return fmt.Errorf("feishu app config: missing credentials")
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: appConfigHTTPTimeout}
	}
	baseURL := opts.Domain
	if baseURL == "" {
		baseURL = OpenBaseURLFeishu
	}

	token, err := tenantAccessToken(ctx, client, baseURL, opts.AppID, opts.AppSecret)
	if err != nil {
		return err
	}

	body := map[string]any{
		"event": map[string]any{
			"subscription_type": subscriptionTypeWebsocket,
			"add_events":        opts.Events,
		},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("feishu app config: marshal: %w", err)
	}
	url := baseURL + fmt.Sprintf(appConfigPath, opts.AppID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("feishu app config: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+token)

	var res baseResponse
	if err := doJSON(client, req, &res); err != nil {
		return err
	}
	if res.Code != 0 {
		return &APIError{Code: res.Code, Msg: res.Msg}
	}
	return nil
}

func tenantAccessToken(ctx context.Context, client *http.Client, baseURL, appID, appSecret string) (string, error) {
	payload, err := json.Marshal(map[string]string{"app_id": appID, "app_secret": appSecret})
	if err != nil {
		return "", fmt.Errorf("feishu app config: marshal credentials: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+tenantTokenPath, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("feishu app config: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	var res tenantTokenResponse
	if err := doJSON(client, req, &res); err != nil {
		return "", err
	}
	if res.Code != 0 {
		return "", &APIError{Code: res.Code, Msg: res.Msg}
	}
	if res.TenantAccessToken == "" {
		return "", fmt.Errorf("feishu app config: platform returned no tenant token")
	}
	return res.TenantAccessToken, nil
}

// doJSON performs the request and decodes the JSON body. The platform
// reports business failures inside the body (with HTTP 200 or 4xx alike),
// so a decodable body is handed back to the caller either way.
func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("feishu app config: %s: %w", req.URL.Path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("feishu app config: read response: %w", err)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("feishu app config: %s: unexpected response (HTTP %d)", req.URL.Path, resp.StatusCode)
	}
	return nil
}
