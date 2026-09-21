package server

import (
	"runtime"
	"testing"
)

func TestParseProcNetListenersKeepsOnlyListeningRows(t *testing.T) {
	// Real /proc/net/tcp shape: a listener on 127.0.0.1:8080, one on 0.0.0.0:22,
	// and an established connection that must not be reported.
	content := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 34567 1 0000 100 0
   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000 100 0
   2: 0100007F:1F90 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 34600 1 0000 100 0
`

	listeners := parseProcNetListeners(content)

	if len(listeners) != 2 {
		t.Fatalf("expected 2 listeners, got %d: %+v", len(listeners), listeners)
	}
	if listeners[0].Port != 8080 || listeners[0].Address != "127.0.0.1" {
		t.Errorf("unexpected first listener: %+v", listeners[0])
	}
	if listeners[0].inode != "34567" {
		t.Errorf("expected socket inode 34567, got %q", listeners[0].inode)
	}
	if listeners[1].Port != 22 || listeners[1].Address != "0.0.0.0" {
		t.Errorf("unexpected second listener: %+v", listeners[1])
	}
}

func TestParseProcNetListenersReadsIPv6Rows(t *testing.T) {
	content := `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55 1 0000 100 0
   1: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 56 1 0000 100 0
   2: 0000000000000000FFFF00000100007F:1389 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 57 1 0000 100 0
`

	listeners := parseProcNetListeners(content)

	if len(listeners) != 3 {
		t.Fatalf("expected 3 listeners, got %d: %+v", len(listeners), listeners)
	}
	expected := []Listener{
		{Port: 8080, Address: "::"},
		{Port: 3000, Address: "::1"},
		// An IPv4-mapped address must print as the dotted quad: that is the form the
		// forwarding rule recognises as loopback.
		{Port: 5001, Address: "127.0.0.1"},
	}
	for index, want := range expected {
		if listeners[index].Listener != want {
			t.Errorf("listener %d: got %+v, want %+v", index, listeners[index].Listener, want)
		}
	}
}

func TestParseProcAddressRejectsMalformedInput(t *testing.T) {
	for _, encoded := range []string{"", "0100007", "zzzzzzzz", "0100007F00"} {
		if address, ok := parseProcAddress(encoded); ok {
			t.Errorf("parseProcAddress(%q) unexpectedly succeeded with %q", encoded, address)
		}
	}
}

func TestSocketInodeFromLink(t *testing.T) {
	if inode, ok := socketInodeFromLink("socket:[12345]"); !ok || inode != "12345" {
		t.Errorf("got (%q, %v), want (\"12345\", true)", inode, ok)
	}
	for _, link := range []string{"/etc/hosts", "pipe:[99]", "socket:[99"} {
		if _, ok := socketInodeFromLink(link); ok {
			t.Errorf("socketInodeFromLink(%q) unexpectedly succeeded", link)
		}
	}
}

// The listener scan is the one method whose answer comes from the kernel rather
// than from files the test can lay out, so on Linux assert against the real /proc
// and elsewhere assert the documented refusal that sends callers to their fallback.
func TestNetListeners(t *testing.T) {
	result, err := netListeners(struct{}{})

	if runtime.GOOS != "linux" {
		if err == nil {
			t.Fatalf("expected net.listeners to be refused on %s", runtime.GOOS)
		}
		if err.Code != "ENOSYS" {
			t.Errorf("expected ENOSYS so the caller falls back, got %q", err.Code)
		}
		return
	}
	if err != nil {
		t.Fatalf("net.listeners failed: %v", err)
	}
	ports, ok := result.(listenersResult)
	if !ok {
		t.Fatalf("unexpected result type %T", result)
	}
	for index := 1; index < len(ports.Ports); index++ {
		if ports.Ports[index-1].Port > ports.Ports[index].Port {
			t.Fatalf("ports are not sorted by port number: %+v", ports.Ports)
		}
	}
}
