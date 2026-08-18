package hostproto

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDecodeInbound_Init(t *testing.T) {
	line := []byte(`{"type":"init","feishu":{"appId":"a","appSecret":"s"},"conversationCwd":"/home/u/.vetta/conversation","state":[{"userId":"u","chatId":"c","sessionPath":"/s.jsonl"}],"logLevel":"info","codingAgent":{"bin":"/app/Vetta.exe","prefixArgs":["/res/coding-agent/dist/agent-rpc-cli.mjs"],"runAsNode":true}}`)
	v, err := DecodeInbound(line)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	init, ok := v.(*InitFrame)
	if !ok {
		t.Fatalf("expected *InitFrame, got %T", v)
	}
	if init.Feishu == nil || init.Feishu.AppID != "a" || init.Feishu.AppSecret != "s" {
		t.Errorf("feishu mismatch: %+v", init.Feishu)
	}
	if init.ConversationCwd != "/home/u/.vetta/conversation" {
		t.Errorf("conversationCwd mismatch: %q", init.ConversationCwd)
	}
	if len(init.State) != 1 || init.State[0].SessionPath != "/s.jsonl" || init.State[0].ChatID != "c" {
		t.Errorf("state mismatch: %+v", init.State)
	}
	if init.LogLevel != "info" {
		t.Errorf("logLevel mismatch: %q", init.LogLevel)
	}
	if init.CodingAgent == nil || init.CodingAgent.Bin != "/app/Vetta.exe" || !init.CodingAgent.RunAsNode {
		t.Errorf("codingAgent mismatch: %+v", init.CodingAgent)
	}
	if len(init.CodingAgent.PrefixArgs) != 1 || init.CodingAgent.PrefixArgs[0] != "/res/coding-agent/dist/agent-rpc-cli.mjs" {
		t.Errorf("codingAgent prefixArgs mismatch: %+v", init.CodingAgent.PrefixArgs)
	}
}

func TestDecodeInbound_ConfigUpdate(t *testing.T) {
	line := []byte(`{"type":"config_update","feishu":{"appId":"a2","appSecret":"s2"}}`)
	v, err := DecodeInbound(line)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	c, ok := v.(*ConfigUpdateFrame)
	if !ok {
		t.Fatalf("type: %T", v)
	}
	if c.Feishu.AppID != "a2" {
		t.Errorf("appId: %q", c.Feishu.AppID)
	}
}

func TestDecodeInbound_Shutdown(t *testing.T) {
	line := []byte(`{"type":"shutdown"}`)
	v, err := DecodeInbound(line)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := v.(*ShutdownFrame); !ok {
		t.Fatalf("type: %T", v)
	}
}

func TestDecodeInbound_InitWechat(t *testing.T) {
	line := []byte(`{"type":"init","wechat":{"enabled":true,"statePath":"/tmp/wx.json"},"conversationCwd":"/c","state":[]}`)
	v, err := DecodeInbound(line)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	init, ok := v.(*InitFrame)
	if !ok {
		t.Fatalf("type: %T", v)
	}
	if init.Wechat == nil || !init.Wechat.Enabled || init.Wechat.StatePath != "/tmp/wx.json" {
		t.Errorf("wechat mismatch: %+v", init.Wechat)
	}
	if init.Feishu != nil {
		t.Errorf("expected nil feishu when wechat is set")
	}
}

func TestDecodeInbound_WechatBindStart(t *testing.T) {
	v, err := DecodeInbound([]byte(`{"type":"wechat_bind_start"}`))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := v.(*WechatBindStartFrame); !ok {
		t.Fatalf("type: %T", v)
	}
}

func TestDecodeInbound_WechatLogout(t *testing.T) {
	v, err := DecodeInbound([]byte(`{"type":"wechat_logout"}`))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := v.(*WechatLogoutFrame); !ok {
		t.Fatalf("type: %T", v)
	}
}

func TestEncodeFrame_WechatEvents(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want string
	}{
		{
			name: "qr",
			in:   WechatQREvent{Type: TypeWechatQR, URL: "https://example/x", Attempt: 1},
			want: `"type":"wechat_qr"`,
		},
		{
			name: "bind_status",
			in: WechatBindStatusEvent{
				Type:   TypeWechatBindStatus,
				Status: WechatBindStatusScanned,
			},
			want: `"type":"wechat_bind_status"`,
		},
		{
			name: "bound",
			in: WechatBoundEvent{
				Type:        TypeWechatBound,
				ILinkBotID:  "bot",
				ILinkUserID: "user",
				BaseURL:     "https://m.example",
			},
			want: `"type":"wechat_bound"`,
		},
		{
			name: "unbound",
			in:   WechatUnboundEvent{Type: TypeWechatUnbound, Reason: "user logout"},
			want: `"type":"wechat_unbound"`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data, err := EncodeFrame(c.in)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if !strings.Contains(string(data), c.want) {
				t.Errorf("got %q, want substring %q", data, c.want)
			}
			if !bytes.HasSuffix(data, []byte("\n")) {
				t.Errorf("frame must end with newline")
			}
		})
	}
}

func TestDecodeInbound_UnknownType(t *testing.T) {
	_, err := DecodeInbound([]byte(`{"type":"weird"}`))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDecodeInbound_MissingType(t *testing.T) {
	_, err := DecodeInbound([]byte(`{}`))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDecodeInbound_BadJSON(t *testing.T) {
	_, err := DecodeInbound([]byte(`not json`))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestEncodeFrame_Ready(t *testing.T) {
	ev := ReadyEvent{Type: TypeReady, Version: "v1", Transport: "feishu"}
	data, err := EncodeFrame(ev)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !bytes.HasSuffix(data, []byte("\n")) {
		t.Errorf("frame must end with newline: %q", data)
	}
	var back ReadyEvent
	if err := json.Unmarshal(bytes.TrimRight(data, "\n"), &back); err != nil {
		t.Fatalf("round-trip parse: %v", err)
	}
	if back.Type != TypeReady || back.Version != "v1" || back.Transport != "feishu" {
		t.Errorf("round-trip mismatch: %+v", back)
	}
}

func TestEncodeFrame_Log(t *testing.T) {
	ev := LogEvent{
		Type:   TypeLog,
		Level:  "info",
		Msg:    "hello",
		Fields: map[string]any{"k": "v", "n": 1},
		Time:   time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC),
	}
	data, err := EncodeFrame(ev)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if strings.Count(string(data), "\n") != 1 {
		t.Errorf("expected exactly one newline, got: %q", data)
	}
}

func TestEncodeFrame_StatePatch_RoundTrip(t *testing.T) {
	ev := StatePatchEvent{
		Type:        TypeStatePatch,
		UserID:      "u",
		ChatID:      "c",
		SessionPath: "/x.jsonl",
		UpdatedAt:   time.Now().UTC().Truncate(time.Second),
	}
	data, err := EncodeFrame(ev)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var back StatePatchEvent
	if err := json.Unmarshal(bytes.TrimRight(data, "\n"), &back); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if back != ev {
		t.Errorf("mismatch:\n got: %+v\nwant: %+v", back, ev)
	}
}

func TestReader_ReadsMultipleFrames(t *testing.T) {
	src := strings.NewReader(`{"type":"init","conversationCwd":"/c","state":[]}` + "\n" +
		`{"type":"shutdown"}` + "\n")
	r := NewReader(src)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go r.Run(ctx)

	var got []string
	for f := range r.Frames() {
		switch f.(type) {
		case *InitFrame:
			got = append(got, "init")
		case *ShutdownFrame:
			got = append(got, "shutdown")
		}
	}
	want := []string{"init", "shutdown"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestReader_EOFClosesChannel(t *testing.T) {
	src := strings.NewReader(`{"type":"init","conversationCwd":"/c","state":[]}` + "\n")
	r := NewReader(src)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go r.Run(ctx)

	count := 0
	for range r.Frames() {
		count++
	}
	if count != 1 {
		t.Errorf("expected 1 frame, got %d", count)
	}
	// errCh should not have any error for plain EOF.
	select {
	case err := <-r.Err():
		t.Errorf("unexpected error on EOF: %v", err)
	default:
	}
}

func TestReader_BadLineSendsErrorAndCloses(t *testing.T) {
	src := strings.NewReader(`{"type":"init","conversationCwd":"/c","state":[]}` + "\n" + `garbage` + "\n")
	r := NewReader(src)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go r.Run(ctx)

	count := 0
	for range r.Frames() {
		count++
	}
	if count != 1 {
		t.Errorf("expected 1 successful frame, got %d", count)
	}
	select {
	case err := <-r.Err():
		if err == nil {
			t.Error("expected non-nil error")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("expected error on errCh")
	}
}

func TestWriter_ConcurrentWrites(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	const N = 50
	done := make(chan struct{}, N)
	for i := range N {
		go func() {
			_ = w.WriteFrame(MetricEvent{Type: TypeMetric, Name: "x", Value: float64(i)})
			done <- struct{}{}
		}()
	}
	for range N {
		<-done
	}
	// Each frame must be a complete line: split by '\n' and ensure every
	// non-empty piece is parseable JSON.
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != N {
		t.Fatalf("expected %d lines, got %d", N, len(lines))
	}
	for _, line := range lines {
		var ev MetricEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			t.Fatalf("line not parseable: %q (%v)", line, err)
		}
		if ev.Type != TypeMetric {
			t.Errorf("type mismatch: %q", ev.Type)
		}
	}
}
