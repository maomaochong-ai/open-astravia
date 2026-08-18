package ilink

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// =============================================================================
// helpers
// =============================================================================

// fakeServer wires a httptest.Server with a per-path handler map. Each test
// installs handlers for the endpoints it needs.
type fakeServer struct {
	t        *testing.T
	srv      *httptest.Server
	handlers map[string]http.HandlerFunc
	mu       atomicMu
}

type atomicMu struct{ n atomic.Int64 }

func (a *atomicMu) inc() { a.n.Add(1) }

func newFakeServer(t *testing.T) *fakeServer {
	t.Helper()
	fs := &fakeServer{
		t:        t,
		handlers: make(map[string]http.HandlerFunc),
	}
	fs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fs.mu.inc()
		if h, ok := fs.handlers[r.URL.Path]; ok {
			h(w, r)
			return
		}
		t.Errorf("fakeServer: unexpected path %s", r.URL.Path)
		http.Error(w, "no handler", http.StatusNotFound)
	}))
	t.Cleanup(fs.srv.Close)
	return fs
}

func (fs *fakeServer) handle(path string, h http.HandlerFunc) {
	fs.handlers[path] = h
}

func (fs *fakeServer) baseURL() string { return fs.srv.URL }

// newTestClient builds a Client pointing at no specific host (callers
// override per-call) with credentials primed.
func newTestClient(t *testing.T, baseURL, token string) *Client {
	t.Helper()
	c := New(Options{HTTPClient: fs1Client()})
	if baseURL != "" || token != "" {
		c.SetCredentials(Credentials{BotToken: token, BaseURL: baseURL})
	}
	return c
}

// fs1Client returns the default http client used by tests. Centralized so
// it's easy to swap to a recording client later.
func fs1Client() *http.Client {
	return &http.Client{Timeout: 5 * time.Second}
}

// readJSON is a small helper for handlers.
func readJSON(t *testing.T, r *http.Request, out any) {
	t.Helper()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("unmarshal body: %v\nraw=%s", err, raw)
	}
}

// =============================================================================
// header construction
// =============================================================================

func TestClientVersion(t *testing.T) {
	cases := map[string]uint32{
		"2.1.7":   (2 << 16) | (1 << 8) | 7, // 131335
		"1.0.11":  (1 << 16) | (0 << 8) | 11, // 65547
		"0.0.0":   0,
		"":        0,
		"foo":     0,
	}
	for in, want := range cases {
		got := ClientVersion(in)
		if got != want {
			t.Errorf("ClientVersion(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestRandomWechatUIN_Shape(t *testing.T) {
	for range 10 {
		uin, err := randomWechatUIN()
		if err != nil {
			t.Fatalf("randomWechatUIN: %v", err)
		}
		dec, err := base64.StdEncoding.DecodeString(uin)
		if err != nil {
			t.Fatalf("uin %q is not base64: %v", uin, err)
		}
		// Decoded value must be a decimal string of a uint32.
		n, err := strconv.ParseUint(string(dec), 10, 32)
		if err != nil {
			t.Fatalf("decoded uin %q is not a uint32 decimal: %v", dec, err)
		}
		_ = n
	}
}

func TestPostHeadersIncludeAllRequiredFields(t *testing.T) {
	fs := newFakeServer(t)
	captured := make(chan http.Header, 1)
	fs.handle("/ilink/bot/sendmessage", func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Header.Clone()
		w.Write([]byte(`{}`))
	})

	c := newTestClient(t, fs.baseURL(), "test-token")
	_, err := c.SendText(context.Background(), SendTextOptions{
		PeerUserID: "peer1",
		Text:       "hi",
	})
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}

	hdr := <-captured
	if got := hdr.Get("iLink-App-Id"); got != "bot" {
		t.Errorf("iLink-App-Id = %q, want %q", got, "bot")
	}
	wantVer := strconv.FormatUint(uint64(ClientVersion(DefaultChannelVersion)), 10)
	if got := hdr.Get("iLink-App-ClientVersion"); got != wantVer {
		t.Errorf("iLink-App-ClientVersion = %q, want %q", got, wantVer)
	}
	if got := hdr.Get("AuthorizationType"); got != "ilink_bot_token" {
		t.Errorf("AuthorizationType = %q, want %q", got, "ilink_bot_token")
	}
	if got := hdr.Get("Authorization"); got != "Bearer test-token" {
		t.Errorf("Authorization = %q, want Bearer test-token", got)
	}
	if got := hdr.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	uin := hdr.Get("X-WECHAT-UIN")
	if uin == "" {
		t.Error("X-WECHAT-UIN missing")
	}
	if _, err := base64.StdEncoding.DecodeString(uin); err != nil {
		t.Errorf("X-WECHAT-UIN is not base64: %v", err)
	}
}

// =============================================================================
// QR bind flow
// =============================================================================

func TestWaitForBind_HappyPath(t *testing.T) {
	// We use a fake server but the bind flow hits FixedQRBaseURL by
	// default. To redirect, we point the client at the fake via a custom
	// http.Client that rewrites the host.
	fs := newFakeServer(t)
	fs.handle("/ilink/bot/get_bot_qrcode", func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("bot_type"); got != "3" {
			t.Errorf("bot_type = %q, want 3", got)
		}
		json.NewEncoder(w).Encode(QRCodeResp{
			Qrcode:           "qr-token-1",
			QrcodeImgContent: "https://example.invalid/scan/qr-token-1",
		})
	})

	pollCount := 0
	fs.handle("/ilink/bot/get_qrcode_status", func(w http.ResponseWriter, r *http.Request) {
		pollCount++
		// First poll: still waiting. Second: scanned. Third: confirmed.
		switch pollCount {
		case 1:
			json.NewEncoder(w).Encode(QRStatusResp{Status: QRStatusWait})
		case 2:
			json.NewEncoder(w).Encode(QRStatusResp{Status: QRStatusScaned})
		default:
			json.NewEncoder(w).Encode(QRStatusResp{
				Status:      QRStatusConfirmed,
				BotToken:    "tok-abc",
				ILinkBotID:  "bot-1",
				ILinkUserID: "user-1",
				BaseURL:     "https://msg.example.invalid",
			})
		}
	})

	c := newTestClient(t, "", "")
	c.httpc = redirectingDoer{base: fs.baseURL()}

	code, err := c.GenerateQR(context.Background())
	if err != nil {
		t.Fatalf("GenerateQR: %v", err)
	}
	if code.Token != "qr-token-1" {
		t.Errorf("token = %q", code.Token)
	}

	res, err := c.WaitForBind(context.Background(), code, nil)
	if err != nil {
		t.Fatalf("WaitForBind: %v", err)
	}
	if res.Credentials.BotToken != "tok-abc" {
		t.Errorf("BotToken = %q", res.Credentials.BotToken)
	}
	if res.Credentials.BaseURL != "https://msg.example.invalid" {
		t.Errorf("BaseURL = %q", res.Credentials.BaseURL)
	}
	// Client should be primed.
	if c.MessagingBaseURL() != "https://msg.example.invalid" {
		t.Errorf("client baseURL not primed")
	}
	if c.botTokenValue() != "tok-abc" {
		t.Errorf("client botToken not primed")
	}
}

func TestWaitForBind_ExpiredThenRefreshThenConfirm(t *testing.T) {
	fs := newFakeServer(t)
	qrIssues := 0
	fs.handle("/ilink/bot/get_bot_qrcode", func(w http.ResponseWriter, r *http.Request) {
		qrIssues++
		json.NewEncoder(w).Encode(QRCodeResp{
			Qrcode:           "qr-" + strconv.Itoa(qrIssues),
			QrcodeImgContent: "https://example.invalid/q/" + strconv.Itoa(qrIssues),
		})
	})

	polls := 0
	fs.handle("/ilink/bot/get_qrcode_status", func(w http.ResponseWriter, r *http.Request) {
		polls++
		token := r.URL.Query().Get("qrcode")
		if polls == 1 {
			if token != "qr-1" {
				t.Errorf("first poll token = %q, want qr-1", token)
			}
			json.NewEncoder(w).Encode(QRStatusResp{Status: QRStatusExpired})
			return
		}
		if token != "qr-2" {
			t.Errorf("post-refresh poll token = %q, want qr-2", token)
		}
		json.NewEncoder(w).Encode(QRStatusResp{
			Status:     QRStatusConfirmed,
			BotToken:   "tok",
			ILinkBotID: "bot",
			BaseURL:    "https://msg.example.invalid",
		})
	})

	c := New(Options{})
	c.httpc = redirectingDoer{base: fs.baseURL()}

	code, err := c.GenerateQR(context.Background())
	if err != nil {
		t.Fatalf("GenerateQR: %v", err)
	}

	events := []BindEvent{}
	res, err := c.WaitForBind(context.Background(), code, func(e BindEvent) {
		events = append(events, e)
	})
	if err != nil {
		t.Fatalf("WaitForBind: %v", err)
	}
	if res.Credentials.BotToken != "tok" {
		t.Errorf("BotToken = %q", res.Credentials.BotToken)
	}
	if qrIssues != 2 {
		t.Errorf("qrIssues = %d, want 2", qrIssues)
	}

	// Should have seen at least: expired, expired (refresh event), confirmed.
	hasExpired := false
	hasConfirmed := false
	for _, e := range events {
		if e.Status == QRStatusExpired {
			hasExpired = true
		}
		if e.Status == QRStatusConfirmed {
			hasConfirmed = true
		}
	}
	if !hasExpired || !hasConfirmed {
		t.Errorf("missing expected events: %+v", events)
	}
}

func TestWaitForBind_ScanedButRedirect(t *testing.T) {
	// Use two fake servers — first hosts QR + redirects, second hosts the
	// post-redirect status polls.
	fs2 := newFakeServer(t)
	fs2.handle("/ilink/bot/get_qrcode_status", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(QRStatusResp{
			Status:     QRStatusConfirmed,
			BotToken:   "tok",
			ILinkBotID: "bot",
			BaseURL:    "https://msg.example.invalid",
		})
	})

	fs1 := newFakeServer(t)
	fs1.handle("/ilink/bot/get_bot_qrcode", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(QRCodeResp{Qrcode: "qr-1", QrcodeImgContent: "x"})
	})
	pollCount := 0
	fs1.handle("/ilink/bot/get_qrcode_status", func(w http.ResponseWriter, r *http.Request) {
		pollCount++
		// First poll: redirect to fs2's host. The bind code will switch
		// to "https://<redirect_host>" — we encode the fs2 host (without
		// scheme) into redirect_host so the client routes there.
		// Strip "http://" prefix from fs2.baseURL().
		host := strings.TrimPrefix(fs2.baseURL(), "http://")
		json.NewEncoder(w).Encode(QRStatusResp{
			Status:       QRStatusScanedButRedirect,
			RedirectHost: host,
		})
	})

	c := New(Options{})
	// Use a doer that routes the FixedQRBaseURL to fs1 but lets
	// "https://<host>" go through unchanged so the redirect target hits
	// fs2 (which is also http://, so we re-route in the doer).
	c.httpc = &qrRedirectDoer{
		fixedHost: fs1.baseURL(),
		// allow https://<fs2 host> to be rerouted to fs2.baseURL()
		passthroughHost: strings.TrimPrefix(fs2.baseURL(), "http://"),
		passthroughBase: fs2.baseURL(),
	}

	code, err := c.GenerateQR(context.Background())
	if err != nil {
		t.Fatalf("GenerateQR: %v", err)
	}
	if _, err := c.WaitForBind(context.Background(), code, nil); err != nil {
		t.Fatalf("WaitForBind: %v", err)
	}
	if pollCount == 0 {
		t.Errorf("redirect host was never polled on the original server")
	}
}

// =============================================================================
// getupdates
// =============================================================================

func TestGetUpdates_HappyPath(t *testing.T) {
	fs := newFakeServer(t)
	fs.handle("/ilink/bot/getupdates", func(w http.ResponseWriter, r *http.Request) {
		var req GetUpdatesReq
		readJSON(t, r, &req)
		if req.GetUpdatesBuf != "cursor-1" {
			t.Errorf("GetUpdatesBuf = %q, want cursor-1", req.GetUpdatesBuf)
		}
		if req.BaseInfo.ChannelVersion == "" {
			t.Errorf("BaseInfo.ChannelVersion empty")
		}
		json.NewEncoder(w).Encode(GetUpdatesResp{
			Ret: 0,
			Msgs: []WeixinMessage{{
				FromUserID:   "alice",
				ContextToken: "ctx-xyz",
				ItemList: []MessageItem{{
					Type:     MessageItemTypeText,
					TextItem: &TextItem{Text: "hello"},
				}},
			}},
			GetUpdatesBuf: "cursor-2",
		})
	})

	c := newTestClient(t, fs.baseURL(), "tok")
	resp, err := c.GetUpdates(context.Background(), "cursor-1")
	if err != nil {
		t.Fatalf("GetUpdates: %v", err)
	}
	if resp.GetUpdatesBuf != "cursor-2" {
		t.Errorf("cursor not advanced: %q", resp.GetUpdatesBuf)
	}
	if len(resp.Msgs) != 1 || resp.Msgs[0].FromUserID != "alice" {
		t.Errorf("msgs = %+v", resp.Msgs)
	}
	if resp.Msgs[0].ContextToken != "ctx-xyz" {
		t.Errorf("context_token not preserved")
	}
}

func TestGetUpdates_SessionTimeoutErrCode(t *testing.T) {
	fs := newFakeServer(t)
	fs.handle("/ilink/bot/getupdates", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(GetUpdatesResp{
			ErrCode: -14,
			ErrMsg:  "session timeout",
		})
	})

	c := newTestClient(t, fs.baseURL(), "tok")
	_, err := c.GetUpdates(context.Background(), "")
	if err == nil {
		t.Fatal("expected ErrSessionTimeout, got nil")
	}
	if !errorsIs(err, ErrSessionTimeout) {
		t.Errorf("err = %v, want ErrSessionTimeout", err)
	}
}

func TestGetUpdates_NoCredentials(t *testing.T) {
	c := New(Options{})
	_, err := c.GetUpdates(context.Background(), "")
	if !errorsIs(err, ErrCredentialsMissing) {
		t.Errorf("err = %v, want ErrCredentialsMissing", err)
	}
}

// =============================================================================
// sendmessage
// =============================================================================

func TestSendText_PayloadShape(t *testing.T) {
	fs := newFakeServer(t)
	captured := make(chan SendMessageReq, 1)
	fs.handle("/ilink/bot/sendmessage", func(w http.ResponseWriter, r *http.Request) {
		var req SendMessageReq
		readJSON(t, r, &req)
		captured <- req
		w.Write([]byte(`{}`))
	})

	c := newTestClient(t, fs.baseURL(), "tok")
	cid, err := c.SendText(context.Background(), SendTextOptions{
		PeerUserID:   "peer42",
		Text:         "hello world",
		ContextToken: "ctx-123",
	})
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}
	if !strings.HasPrefix(cid, "vetta-wechat-") {
		t.Errorf("client_id prefix wrong: %q", cid)
	}

	got := <-captured
	if got.Msg == nil {
		t.Fatal("Msg nil")
	}
	if got.Msg.ToUserID != "peer42" {
		t.Errorf("ToUserID = %q", got.Msg.ToUserID)
	}
	if got.Msg.MessageType != MessageTypeBot {
		t.Errorf("MessageType = %d, want %d", got.Msg.MessageType, MessageTypeBot)
	}
	if got.Msg.MessageState != MessageStateFinish {
		t.Errorf("MessageState = %d, want %d", got.Msg.MessageState, MessageStateFinish)
	}
	if got.Msg.ContextToken != "ctx-123" {
		t.Errorf("ContextToken = %q", got.Msg.ContextToken)
	}
	if len(got.Msg.ItemList) != 1 {
		t.Fatalf("ItemList len = %d, want 1", len(got.Msg.ItemList))
	}
	item := got.Msg.ItemList[0]
	if item.Type != MessageItemTypeText {
		t.Errorf("item.Type = %d", item.Type)
	}
	if item.TextItem == nil || item.TextItem.Text != "hello world" {
		t.Errorf("text = %+v", item.TextItem)
	}
	if got.Msg.ClientID != cid {
		t.Errorf("ClientID = %q, want returned cid %q", got.Msg.ClientID, cid)
	}
}

func TestSendText_NoCredentials(t *testing.T) {
	c := New(Options{})
	_, err := c.SendText(context.Background(), SendTextOptions{PeerUserID: "p", Text: "x"})
	if !errorsIs(err, ErrCredentialsMissing) {
		t.Errorf("err = %v, want ErrCredentialsMissing", err)
	}
}

func TestSendText_HTTPError(t *testing.T) {
	fs := newFakeServer(t)
	fs.handle("/ilink/bot/sendmessage", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})
	c := newTestClient(t, fs.baseURL(), "tok")
	_, err := c.SendText(context.Background(), SendTextOptions{PeerUserID: "p", Text: "x"})
	if err == nil {
		t.Fatal("expected HTTP error")
	}
	var herr *HTTPError
	if !asError(err, &herr) {
		t.Fatalf("err type = %T, want *HTTPError: %v", err, err)
	}
	if herr.Status != 500 {
		t.Errorf("status = %d", herr.Status)
	}
}

// =============================================================================
// errors helpers — using a thin local wrapper to avoid importing errors
// twice in test code that already has lots of imports.
// =============================================================================

func errorsIs(err, target error) bool {
	for e := err; e != nil; {
		if e == target {
			return true
		}
		un, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = un.Unwrap()
	}
	return false
}

func asError[T error](err error, target *T) bool {
	for e := err; e != nil; {
		if t, ok := e.(T); ok {
			*target = t
			return true
		}
		un, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = un.Unwrap()
	}
	return false
}

// =============================================================================
// test doers (route the hardcoded FixedQRBaseURL to a httptest.Server)
// =============================================================================

// redirectingDoer rewrites every request URL to point at a single base.
// Used by bind tests so the hardcoded FixedQRBaseURL hits our fake server.
type redirectingDoer struct {
	base string
}

func (d redirectingDoer) Do(req *http.Request) (*http.Response, error) {
	rewriteRequestHost(req, d.base)
	return http.DefaultClient.Do(req)
}

// qrRedirectDoer routes the QR fixed host to fs1, and a specific
// "passthrough" virtual host to fs2. Used by the IDC redirect test.
type qrRedirectDoer struct {
	fixedHost       string // e.g. http://127.0.0.1:NNNN
	passthroughHost string // host:port virtual host
	passthroughBase string // e.g. http://127.0.0.1:MMMM
}

func (d *qrRedirectDoer) Do(req *http.Request) (*http.Response, error) {
	if req.URL.Host == d.passthroughHost || req.Host == d.passthroughHost {
		rewriteRequestHost(req, d.passthroughBase)
	} else {
		rewriteRequestHost(req, d.fixedHost)
	}
	return http.DefaultClient.Do(req)
}

func rewriteRequestHost(req *http.Request, base string) {
	u, _ := req.URL.Parse(req.URL.String())
	target, _ := req.URL.Parse(base)
	u.Scheme = target.Scheme
	u.Host = target.Host
	req.URL = u
	req.Host = target.Host
}
