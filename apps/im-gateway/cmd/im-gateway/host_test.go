package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostproto"
	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/wechat"
	"vetta-im-gateway/internal/transport/wechat/ilink"
)

// stubTransport is a no-op transport that just blocks Start() until ctx
// is cancelled. Used to exercise the host runtime without touching
// network. Calls to Stop unblock Start by returning context.Canceled.
type stubTransport struct {
	name string
	// Configurable error to return from Start. nil → block until ctx done.
	startErr error
}

func newStubTransport(name string) *stubTransport { return &stubTransport{name: name} }

func (s *stubTransport) Name() string                      { return s.name }
func (s *stubTransport) Capabilities() transport.Capabilities { return transport.Capabilities{} }
func (s *stubTransport) Start(ctx context.Context, _ transport.MessageHandler) error {
	if s.startErr != nil {
		return s.startErr
	}
	<-ctx.Done()
	return ctx.Err()
}
func (s *stubTransport) Stop() error { return nil }
func (s *stubTransport) SendMessage(_ context.Context, _ string, _ transport.OutboundMessage) (string, error) {
	return "", nil
}
func (s *stubTransport) EditMessage(_ context.Context, _, _ string, _ transport.OutboundMessage) error {
	return nil
}
func (s *stubTransport) DeleteMessage(_ context.Context, _, _ string) error { return nil }
func (s *stubTransport) ShowTyping(_ context.Context, _ string) error       { return nil }
func (s *stubTransport) EndStream(_ context.Context, _, _ string) error     { return nil }
func (s *stubTransport) SendAttachment(_ context.Context, _ string, _ transport.OutboundAttachment) (string, error) {
	return "", nil
}

// stubBuilder returns a stubTransport ignoring the spec (allows tests
// to bypass the feishu credential validation).
func stubBuilder(_ *buildSpec) (transport.Transport, error) {
	return newStubTransport("stub"), nil
}

// captureWriter is an io.Writer that records every Write under a mutex
// so test goroutines can read it back.
type captureWriter struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (c *captureWriter) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.Write(p)
}

func (c *captureWriter) Bytes() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]byte, c.buf.Len())
	copy(out, c.buf.Bytes())
	return out
}

func (c *captureWriter) Lines() []map[string]any {
	raw := c.Bytes()
	lines := bytes.Split(bytes.TrimRight(raw, "\n"), []byte("\n"))
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		if len(l) == 0 {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal(l, &m); err == nil {
			out = append(out, m)
		}
	}
	return out
}

// waitForType polls the captureWriter for an event of the given type.
func waitForType(t *testing.T, w *captureWriter, typ string, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, ev := range w.Lines() {
			if ev["type"] == typ {
				return ev
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for event type=%q. captured:\n%s", typ, w.Bytes())
	return nil
}

// pipeReader is a thread-safe in-memory reader with blocking Read.
// Lifted shape from integration_test.go's pipeBuffer; reused here so the
// host runtime sees the same "blocks until data" behavior as a real pipe.
type pipeReader struct {
	mu      sync.Mutex
	buf     bytes.Buffer
	readPos int
	closed  bool
}

func newPipeReader() *pipeReader { return &pipeReader{} }

func (p *pipeReader) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.buf.Write(b)
}

func (p *pipeReader) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	return nil
}

func (p *pipeReader) Read(b []byte) (int, error) {
	for {
		p.mu.Lock()
		if p.readPos < p.buf.Len() {
			data := p.buf.Bytes()[p.readPos:]
			n := copy(b, data)
			p.readPos += n
			p.mu.Unlock()
			return n, nil
		}
		closed := p.closed
		p.mu.Unlock()
		if closed {
			return 0, errEOF
		}
		time.Sleep(5 * time.Millisecond)
	}
}

var errEOF = errors.New("EOF")

const testConversationCwd = "/home/u/.vetta/conversation"

// TestHost_InitTimeout asserts the sidecar exits non-zero when the parent
// fails to send an init frame within the timeout.
func TestHost_InitTimeout(t *testing.T) {
	// pipeReader that we never write to → simulates parent that never
	// sends an init frame. Use a short timeout to keep the test fast.
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder,
			initTimeout:    150 * time.Millisecond,
		})
	}()

	select {
	case code := <-done:
		if code == 0 {
			t.Fatalf("expected non-zero exit code on init timeout, got 0")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runHostWithIO did not return after init timeout")
	}
}

// TestHost_InitReadyShutdown exercises the full init → ready → shutdown
// handshake using a stub transport.
func TestHost_InitReadyShutdown(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder,
			initTimeout:    2 * time.Second,
			shutdownGrace:  500 * time.Millisecond,
		})
	}()

	// Send init frame.
	initFrame := hostproto.InitFrame{
		Type: hostproto.TypeInit,
		Feishu: &hostproto.FeishuConfig{
			AppID:     "stub-app",
			AppSecret: "stub-secret",
		},
		ConversationCwd: testConversationCwd,
		State:           nil,
	}
	data, err := hostproto.EncodeFrame(initFrame)
	if err != nil {
		t.Fatalf("encode init: %v", err)
	}
	in.Write(data)

	// Wait for ready event.
	ready := waitForType(t, out, hostproto.TypeReady, 2*time.Second)
	if ready["transport"] != "stub" {
		t.Errorf("ready transport = %v, want stub", ready["transport"])
	}

	// Wait for online status.
	waitForType(t, out, hostproto.TypeStatus, time.Second)

	// Send shutdown frame.
	sd, _ := hostproto.EncodeFrame(hostproto.ShutdownFrame{Type: hostproto.TypeShutdown})
	in.Write(sd)

	select {
	case code := <-done:
		if code != 0 {
			t.Errorf("exit code on shutdown = %d, want 0", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runHostWithIO did not return after shutdown frame")
	}
}

// TestHost_InitWithoutConversationCwd asserts the sidecar refuses to start
// when the init frame omits conversationCwd — the gateway can't route
// without knowing where sessions should live.
func TestHost_InitWithoutConversationCwd(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder,
			initTimeout:    1 * time.Second,
		})
	}()

	bad := hostproto.InitFrame{
		Type:   hostproto.TypeInit,
		Feishu: &hostproto.FeishuConfig{AppID: "x", AppSecret: "y"},
		// ConversationCwd intentionally empty.
	}
	data, _ := hostproto.EncodeFrame(bad)
	in.Write(data)

	select {
	case code := <-done:
		if code == 0 {
			t.Error("expected non-zero exit when conversationCwd is missing")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runHostWithIO did not return")
	}
}

// TestHost_StdinEOFShutdown asserts that closing stdin is equivalent to a
// shutdown frame.
func TestHost_StdinEOFShutdown(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder,
			initTimeout:    2 * time.Second,
			shutdownGrace:  500 * time.Millisecond,
		})
	}()

	data, _ := hostproto.EncodeFrame(hostproto.InitFrame{
		Type:            hostproto.TypeInit,
		Feishu:          &hostproto.FeishuConfig{AppID: "x", AppSecret: "y"},
		ConversationCwd: testConversationCwd,
	})
	in.Write(data)

	waitForType(t, out, hostproto.TypeReady, 2*time.Second)

	// Close stdin → EOF.
	in.Close()

	select {
	case code := <-done:
		if code != 0 {
			t.Errorf("exit code on EOF = %d, want 0", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runHostWithIO did not return after stdin EOF")
	}
}

// TestHost_BadInitFrameType verifies that the first non-init frame causes
// a non-zero exit.
func TestHost_BadInitFrameType(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder,
			initTimeout:    2 * time.Second,
		})
	}()

	// Send a shutdown frame as the very first frame; this should be
	// rejected (init must come first).
	sd, _ := hostproto.EncodeFrame(hostproto.ShutdownFrame{Type: hostproto.TypeShutdown})
	in.Write(sd)

	select {
	case code := <-done:
		if code == 0 {
			t.Errorf("expected non-zero exit when first frame is not init")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runHostWithIO did not return")
	}
}

// TestHost_WechatInitAwaitingBind asserts the sidecar parks in the
// awaiting_bind status when init selects wechat but no credentials are
// persisted yet. This is the path the desktop-app's WeChat card relies on
// when the user first opens the bind dialog: the sidecar must come up
// healthy (so the bind frame can be delivered) without trying to start
// any transport.
//
// Uses the real production buildHostTransport — exercises the
// errAwaitingBind branch end-to-end.
func TestHost_WechatInitAwaitingBind(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	// Empty temp dir → no wechat state file → wechat.New returns
	// ErrNotBound → buildHostTransport returns errAwaitingBind.
	statePath := filepath.Join(t.TempDir(), "wechat.json")

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:         in,
			stdout:        out,
			initTimeout:   2 * time.Second,
			shutdownGrace: 500 * time.Millisecond,
		})
	}()

	initFrame := hostproto.InitFrame{
		Type: hostproto.TypeInit,
		Wechat: &hostproto.WechatConfig{
			Enabled:   true,
			StatePath: statePath,
		},
		ConversationCwd: testConversationCwd,
	}
	data, err := hostproto.EncodeFrame(initFrame)
	if err != nil {
		t.Fatalf("encode init: %v", err)
	}
	in.Write(data)

	// Ready event should fire with the placeholder transport name.
	ready := waitForType(t, out, hostproto.TypeReady, 2*time.Second)
	if ready["transport"] != "placeholder" {
		t.Errorf("ready transport = %v, want placeholder", ready["transport"])
	}

	// We should see at least one status event with awaiting_bind.
	deadline := time.Now().Add(2 * time.Second)
	sawAwaiting := false
	for time.Now().Before(deadline) {
		for _, ev := range out.Lines() {
			if ev["type"] == hostproto.TypeStatus && ev["transport"] == hostproto.TransportStatusAwaitingBind {
				sawAwaiting = true
				break
			}
		}
		if sawAwaiting {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !sawAwaiting {
		t.Fatalf("never saw awaiting_bind status. captured:\n%s", out.Bytes())
	}

	// Shutdown should still work cleanly even though no transport is running.
	sd, _ := hostproto.EncodeFrame(hostproto.ShutdownFrame{Type: hostproto.TypeShutdown})
	in.Write(sd)

	select {
	case code := <-done:
		if code != 0 {
			t.Errorf("exit code on shutdown = %d, want 0", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runHostWithIO did not return after shutdown frame")
	}
}

// TestHost_WechatBindStartIgnoredWhenInactive asserts that wechat_bind_start
// frames sent to a sidecar in feishu mode are logged but cause no harm —
// they should not panic, leak goroutines, or affect the running feishu
// transport.
func TestHost_WechatBindStartIgnoredWhenInactive(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: stubBuilder, // feishu-stub path; no wechat coord
			initTimeout:    2 * time.Second,
			shutdownGrace:  500 * time.Millisecond,
		})
	}()

	initFrame := hostproto.InitFrame{
		Type: hostproto.TypeInit,
		Feishu: &hostproto.FeishuConfig{
			AppID:     "stub",
			AppSecret: "stub",
		},
		ConversationCwd: testConversationCwd,
	}
	data, _ := hostproto.EncodeFrame(initFrame)
	in.Write(data)
	waitForType(t, out, hostproto.TypeReady, 2*time.Second)

	// Send wechat_bind_start: should be safely ignored.
	bs, _ := hostproto.EncodeFrame(hostproto.WechatBindStartFrame{Type: hostproto.TypeWechatBindStart})
	in.Write(bs)

	// Give the loop a moment to process the frame.
	time.Sleep(100 * time.Millisecond)

	// No wechat_qr / wechat_bind_status should appear.
	for _, ev := range out.Lines() {
		if ev["type"] == hostproto.TypeWechatQR || ev["type"] == hostproto.TypeWechatBindStatus {
			t.Errorf("unexpected wechat event in feishu-only mode: %v", ev)
		}
	}

	sd, _ := hostproto.EncodeFrame(hostproto.ShutdownFrame{Type: hostproto.TypeShutdown})
	in.Write(sd)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("did not exit")
	}
}

// TestHost_WechatSessionTimeoutRecovers asserts that when a previously-bound
// wechat session is rejected by the server (errcode -14 → ErrSessionTimeout
// from Start()), the host clears the dead credentials, drops back to
// awaiting_bind, and KEEPS THE SIDECAR ALIVE so the user's next "扫码绑定"
// click can deliver a wechat_bind_start frame. Regression: previously the
// host treated this as a fatal transport error and exited, leaving the
// desktop-app stuck on a spinner.
func TestHost_WechatSessionTimeoutRecovers(t *testing.T) {
	in := newPipeReader()
	out := &captureWriter{}

	// Seed a state file with non-empty credentials so the wechat
	// coordinator gets constructed and LogoutAndClear has something to
	// remove.
	statePath := filepath.Join(t.TempDir(), "wechat.json")
	store, err := wechat.NewStateStoreForCLI(statePath)
	if err != nil {
		t.Fatalf("NewStateStoreForCLI: %v", err)
	}
	if err := store.SetCredentials(ilink.Credentials{
		BotToken:   "dead-token",
		ILinkBotID: "expired-bot",
		BaseURL:    "https://example.invalid",
	}); err != nil {
		t.Fatalf("seed creds: %v", err)
	}

	// Custom builder: returns a transport whose Start immediately
	// returns ErrSessionTimeout. Simulates a -14 from getupdates.
	builder := func(spec *buildSpec) (transport.Transport, error) {
		if spec.Wechat == nil {
			return newStubTransport("stub"), nil
		}
		return &stubTransport{name: "wechat", startErr: ilink.ErrSessionTimeout}, nil
	}

	done := make(chan int, 1)
	go func() {
		done <- runHostWithIO(hostOptions{
			stdin:          in,
			stdout:         out,
			buildTransport: builder,
			initTimeout:    2 * time.Second,
			shutdownGrace:  500 * time.Millisecond,
		})
	}()

	initFrame := hostproto.InitFrame{
		Type: hostproto.TypeInit,
		Wechat: &hostproto.WechatConfig{
			Enabled:   true,
			StatePath: statePath,
		},
		ConversationCwd: testConversationCwd,
	}
	data, _ := hostproto.EncodeFrame(initFrame)
	in.Write(data)

	waitForType(t, out, hostproto.TypeReady, 2*time.Second)

	// After the transport's immediate failure the host should recover to
	// awaiting_bind and emit wechat_unbound. Sidecar must stay alive.
	deadline := time.Now().Add(3 * time.Second)
	sawAwaiting := false
	sawUnbound := false
	for time.Now().Before(deadline) && !(sawAwaiting && sawUnbound) {
		for _, ev := range out.Lines() {
			if ev["type"] == hostproto.TypeStatus && ev["transport"] == hostproto.TransportStatusAwaitingBind {
				sawAwaiting = true
			}
			if ev["type"] == hostproto.TypeWechatUnbound {
				sawUnbound = true
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !sawAwaiting {
		t.Errorf("never saw awaiting_bind after session timeout. captured:\n%s", out.Bytes())
	}
	if !sawUnbound {
		t.Errorf("never saw wechat_unbound after session timeout. captured:\n%s", out.Bytes())
	}

	// Sidecar must NOT have exited.
	select {
	case code := <-done:
		t.Fatalf("sidecar exited early with code=%d after session timeout; should have recovered. captured:\n%s", code, out.Bytes())
	case <-time.After(200 * time.Millisecond):
	}

	// Confirm dead credentials were cleared from disk.
	freshStore, _ := wechat.NewStateStoreForCLI(statePath)
	if freshStore.HasCredentials() {
		t.Errorf("dead credentials should have been cleared from %s", statePath)
	}

	// Clean shutdown still works.
	sd, _ := hostproto.EncodeFrame(hostproto.ShutdownFrame{Type: hostproto.TypeShutdown})
	in.Write(sd)
	select {
	case code := <-done:
		if code != 0 {
			t.Errorf("exit code = %d, want 0", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not exit after shutdown frame")
	}
}
