package discord

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/gorilla/websocket"
)

// intentMessageContent is Discord's MESSAGE CONTENT bit (1<<15). It is a
// privileged intent: a bot whose owner has not toggled it on in the
// developer portal is rejected at identify with websocket close 4014.
const intentMessageContent = 1 << 15

// fakeGateway is a stand-in for Discord's REST + websocket gateway. It
// replays the real handshake (Hello → Identify → Ready) so the transport
// can be exercised through discordgo instead of only at the handler seam.
//
// rejectPrivileged mirrors Discord's behaviour for a bot without the
// MESSAGE CONTENT privilege: any identify requesting that intent is
// closed with 4014 instead of receiving Ready.
type fakeGateway struct {
	server           *httptest.Server
	rejectPrivileged bool

	mu         sync.Mutex
	intents    int
	identifies int
	dials      int
	failDials  int
	identify   chan struct{}

	// messages queued to push after Ready.
	push []string
}

func newFakeGateway(t *testing.T, rejectPrivileged bool, push ...string) *fakeGateway {
	t.Helper()
	g := &fakeGateway{rejectPrivileged: rejectPrivileged, identify: make(chan struct{}, 1), push: push}

	mux := http.NewServeMux()
	mux.HandleFunc("/gateway", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		wsURL := "ws" + strings.TrimPrefix(g.server.URL, "http") + "/ws"
		_ = json.NewEncoder(w).Encode(map[string]string{"url": wsURL})
	})
	// discordgo appends a trailing slash to the gateway URL it fetches.
	mux.HandleFunc("/ws", g.serveWS)
	mux.HandleFunc("/ws/", g.serveWS)
	g.server = httptest.NewServer(mux)

	prevGateway := discordgo.EndpointGateway
	discordgo.EndpointGateway = g.server.URL + "/gateway"
	t.Cleanup(func() {
		discordgo.EndpointGateway = prevGateway
		g.server.Close()
	})
	return g
}

func (g *fakeGateway) serveWS(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	g.dials++
	drop := g.failDials > 0
	if drop {
		g.failDials--
	}
	g.mu.Unlock()
	if drop {
		// Cut the TCP connection mid-handshake so the client's dial fails
		// with EOF — the exact failure seen against gateway.discord.gg on
		// a flaky network.
		hj, ok := w.(http.Hijacker)
		if !ok {
			return
		}
		conn, _, err := hj.Hijack()
		if err == nil {
			_ = conn.Close()
		}
		return
	}

	conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Op 10 Hello.
	if err := conn.WriteJSON(map[string]any{
		"op": 10,
		"d":  map[string]any{"heartbeat_interval": 45000},
	}); err != nil {
		return
	}

	// Read frames until we see the Op 2 Identify.
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var frame struct {
			Op int `json:"op"`
			D  struct {
				Intents int `json:"intents"`
			} `json:"d"`
		}
		if json.Unmarshal(raw, &frame) != nil || frame.Op != 2 {
			continue
		}

		g.mu.Lock()
		g.intents = frame.D.Intents
		g.identifies++
		g.mu.Unlock()
		select {
		case g.identify <- struct{}{}:
		default:
		}

		if g.rejectPrivileged && frame.D.Intents&intentMessageContent != 0 {
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(4014, "Disallowed intent(s)."),
				time.Now().Add(time.Second),
			)
			return
		}

		_ = conn.WriteJSON(map[string]any{
			"op": 0,
			"t":  "READY",
			"s":  1,
			"d": map[string]any{
				"v":          10,
				"session_id": "sess-1",
				"user":       map[string]any{"id": "bot-1", "username": "vetta", "bot": true},
				"guilds":     []any{},
			},
		})
		for i, payload := range g.push {
			_ = conn.WriteMessage(websocket.TextMessage, fmt.Appendf(nil, payload, i+2))
		}
		// Hold the connection open until the client hangs up.
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}
}

func (g *fakeGateway) sentIntents() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.intents
}

func (g *fakeGateway) counts() (dials, identifies int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.dials, g.identifies
}

func (g *fakeGateway) setFailDials(n int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.failDials = n
}

// dmMessageCreate is a MESSAGE_CREATE dispatch for a direct message
// (no guild_id). %d is the sequence number.
const dmMessageCreate = `{"op":0,"t":"MESSAGE_CREATE","s":%d,"d":{` +
	`"id":"msg-1","channel_id":"dm-1","content":"hello from dm",` +
	`"author":{"id":"user-1","username":"tester"}}}`

func startTransport(t *testing.T, tr *Transport, h *captureHandler) chan error {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- tr.Start(ctx, h) }()
	t.Cleanup(func() {
		cancel()
		_ = tr.Stop()
	})
	return done
}

// TestStart_ConnectsWithoutPrivilegedIntent is the regression guard for
// "Discord 桥接不上": requesting the privileged MESSAGE CONTENT intent
// makes Discord reject the identify with close 4014 for every bot whose
// owner has not enabled that toggle. The transport only ever reads DMs
// and messages that @-mention the bot — both of which Discord exempts
// from the privilege — so the intent must not be requested.
func TestStart_ConnectsWithoutPrivilegedIntent(t *testing.T) {
	gw := newFakeGateway(t, true, dmMessageCreate)
	tr, err := New(Options{BotToken: "test-token"})
	if err != nil {
		t.Fatal(err)
	}
	h := &captureHandler{}
	done := startTransport(t, tr, h)

	select {
	case <-gw.identify:
	case err := <-done:
		t.Fatalf("Start returned before identify: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("gateway never received identify")
	}

	if got := gw.sentIntents(); got&intentMessageContent != 0 {
		t.Fatalf("identify requested privileged MESSAGE CONTENT intent (intents=%d); "+
			"Discord answers 4014 Disallowed intent(s) unless the portal toggle is on", got)
	}

	waitForInbound(t, h, 1)
	msgs := h.snapshot()
	if msgs[0].Text != "hello from dm" || msgs[0].ChatID != "dm-1" || msgs[0].UserID != "user-1" {
		t.Fatalf("unexpected inbound: %+v", msgs[0])
	}
}

// TestStart_SurfacesDisallowedIntent proves the failure mode is reported
// rather than swallowed: when the gateway rejects the identify, Start
// returns an error carrying the close code so the host can show it.
func TestStart_SurfacesDisallowedIntent(t *testing.T) {
	gw := newFakeGateway(t, true)
	tr, err := New(Options{BotToken: "test-token"})
	if err != nil {
		t.Fatal(err)
	}
	// Force the rejected path regardless of the production intent set.
	tr.session.Identify.Intents = discordgo.IntentGuilds | intentMessageContent

	h := &captureHandler{}
	done := startTransport(t, tr, h)

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "4014") {
			t.Fatalf("expected Start to surface close 4014, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Start never returned after gateway rejection")
	}
	if gw.sentIntents()&intentMessageContent == 0 {
		t.Fatal("test did not exercise the privileged-intent path")
	}
}

func waitForInbound(t *testing.T, h *captureHandler, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if len(h.snapshot()) >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d inbound message(s); got %d", want, len(h.snapshot()))
}

func TestOpenFailure(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"bad token", fmt.Errorf("websocket: close 4004 (Authentication failed.)"), "bot token rejected"},
		{"disallowed intents", fmt.Errorf("websocket: close 4014 (Disallowed intent(s).)"), "privileged intent"},
		{"sharding", fmt.Errorf("websocket: close 4011 (Sharding required.)"), "sharding"},
		{"unknown", fmt.Errorf("dial tcp: connection refused"), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := openFailure(tc.err)
			if tc.want == "" {
				if got != "" {
					t.Fatalf("expected no hint, got %q", got)
				}
				return
			}
			if !strings.Contains(got, tc.want) {
				t.Fatalf("hint %q does not mention %q", got, tc.want)
			}
		})
	}
}

// fastRetry keeps the retry path from dominating test runtime.
func fastRetry(opts Options) Options {
	opts.BotToken = "test-token"
	opts.ConnectInitialBackoff = 5 * time.Millisecond
	opts.ConnectMaxBackoff = 20 * time.Millisecond
	return opts
}

// TestStart_RetriesDroppedDial is the regression guard for the reported
// "连接不稳定，一下正常一下错误": a dropped gateway dial must not abort
// Start. Returning the error made the host tear the sidecar down and the
// desktop respawn the whole process on every network blip.
func TestStart_RetriesDroppedDial(t *testing.T) {
	gw := newFakeGateway(t, false, dmMessageCreate)
	gw.setFailDials(3)

	tr, err := New(fastRetry(Options{}))
	if err != nil {
		t.Fatal(err)
	}
	h := &captureHandler{}
	done := startTransport(t, tr, h)

	select {
	case <-gw.identify:
	case err := <-done:
		t.Fatalf("Start gave up on a transient dial failure: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("gateway never received identify")
	}

	waitForInbound(t, h, 1)
	dials, _ := gw.counts()
	if dials != 4 {
		t.Fatalf("expected 3 dropped dials then 1 success, got %d dials", dials)
	}
}

// TestStart_GivesUpAfterMaxAttempts keeps an unreachable gateway visible:
// retrying forever behind an "online" badge would hide a real outage.
func TestStart_GivesUpAfterMaxAttempts(t *testing.T) {
	gw := newFakeGateway(t, false)
	gw.setFailDials(1000)

	opts := fastRetry(Options{})
	opts.ConnectMaxAttempts = 3
	tr, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	done := startTransport(t, tr, &captureHandler{})

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "gave up after 3 attempts") {
			t.Fatalf("expected give-up error, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Start never returned")
	}
	if dials, _ := gw.counts(); dials != 3 {
		t.Fatalf("expected exactly 3 dials, got %d", dials)
	}
}

// TestStart_DoesNotRetryPermanentRejection proves a bad token or refused
// intent still fails fast instead of burning the whole backoff budget.
func TestStart_DoesNotRetryPermanentRejection(t *testing.T) {
	gw := newFakeGateway(t, true)
	tr, err := New(fastRetry(Options{}))
	if err != nil {
		t.Fatal(err)
	}
	tr.session.Identify.Intents = discordgo.IntentGuilds | intentMessageContent

	done := startTransport(t, tr, &captureHandler{})
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "4014") {
			t.Fatalf("expected 4014 to surface, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Start never returned")
	}
	if _, identifies := gw.counts(); identifies != 1 {
		t.Fatalf("permanent rejection was retried: %d identifies", identifies)
	}
}
