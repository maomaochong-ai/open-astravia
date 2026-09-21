package server

import (
	"encoding/hex"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"vetta-ssh-helper/internal/protocol"
)

// Listener is one TCP port in LISTEN state on this host.
type Listener struct {
	Port        int    `json:"port"`
	Address     string `json:"address"`
	ProcessName string `json:"process,omitempty"`
	Pid         int    `json:"pid,omitempty"`
}

// procTCPState marks a LISTEN socket in /proc/net/tcp.
const procTCPState = "0A"

type listenersResult struct {
	Ports []Listener `json:"ports"`
}

// netListeners answers which TCP ports are accepting connections, so the desktop
// side can offer them for port forwarding.
//
// Only Linux is implemented, from /proc — the point of doing it here rather than
// shelling out is that a minimal image may carry none of ss, netstat or lsof, and
// /proc is always there. Elsewhere (macOS) there is no such gap: the caller's
// `ssh exec` fallback runs lsof, which ships with the system, so reporting ENOSYS
// sends it down that path instead of duplicating the parser in two languages.
func netListeners(struct{}) (any, *protocol.Error) {
	if runtime.GOOS != "linux" {
		return nil, protocol.Errorf(protocol.CodeUnknownMethod, "net.listeners is only implemented on linux")
	}
	listeners := make([]Listener, 0, 16)
	inodes := make(map[string]int)
	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		content, err := os.ReadFile(path)
		if err != nil {
			// tcp6 is absent on a kernel without IPv6; that is not a failure of the call.
			continue
		}
		for _, entry := range parseProcNetListeners(string(content)) {
			listeners = append(listeners, entry.Listener)
			if entry.inode != "" && entry.inode != "0" {
				inodes[entry.inode] = len(listeners) - 1
			}
		}
	}
	for inode, owner := range findSocketOwners(inodes) {
		listeners[inodes[inode]].Pid = owner.pid
		listeners[inodes[inode]].ProcessName = owner.name
	}
	sort.Slice(listeners, func(i, j int) bool { return listeners[i].Port < listeners[j].Port })
	return listenersResult{Ports: listeners}, nil
}

type procListener struct {
	Listener
	inode string
}

// parseProcNetListeners reads /proc/net/tcp or /proc/net/tcp6, keeping the rows
// in LISTEN state. Columns are fixed by the kernel, so positions are safe here in
// a way they are not for the output of a userspace tool.
func parseProcNetListeners(content string) []procListener {
	listeners := make([]procListener, 0, 8)
	for line := range strings.SplitSeq(content, "\n") {
		fields := strings.Fields(line)
		// sl local rem st tx:rx tr:when retrnsmt uid timeout inode
		if len(fields) < 10 || fields[3] != procTCPState {
			continue
		}
		address, port, ok := splitProcEndpoint(fields[1])
		if !ok {
			continue
		}
		listeners = append(listeners, procListener{
			Listener: Listener{Port: port, Address: address},
			inode:    fields[9],
		})
	}
	return listeners
}

// splitProcEndpoint decodes a `<hex address>:<hex port>` column.
func splitProcEndpoint(endpoint string) (string, int, bool) {
	separator := strings.LastIndex(endpoint, ":")
	if separator < 0 {
		return "", 0, false
	}
	port, err := strconv.ParseUint(endpoint[separator+1:], 16, 32)
	if err != nil || port == 0 || port > 65535 {
		return "", 0, false
	}
	address, ok := parseProcAddress(endpoint[:separator])
	if !ok {
		return "", 0, false
	}
	return address, int(port), true
}

// parseProcAddress turns the kernel's hex address into a printable one.
//
// The bytes are grouped into 32-bit words in host order, which on every platform
// Linux runs this on means little-endian: `0100007F` is 127.0.0.1, not 1.0.0.127.
// An IPv4-mapped IPv6 address prints as its dotted quad, which is also how the
// forwarding rule treats it.
func parseProcAddress(encoded string) (string, bool) {
	if len(encoded)%8 != 0 || len(encoded) == 0 {
		return "", false
	}
	raw, err := hex.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	for word := 0; word < len(raw); word += 4 {
		raw[word], raw[word+3] = raw[word+3], raw[word]
		raw[word+1], raw[word+2] = raw[word+2], raw[word+1]
	}
	ip := net.IP(raw)
	if ip.To16() == nil {
		return "", false
	}
	return ip.String(), true
}

// findSocketOwners maps socket inodes to the processes holding them.
//
// One walk of /proc covers every inode: scanning per inode would re-read every
// process's file descriptors once per forwarded port. Processes owned by other
// users are unreadable for an ordinary login, so an inode with no owner is
// expected and simply stays absent from the result — never an error.
func findSocketOwners(inodes map[string]int) map[string]socketOwner {
	owners := make(map[string]socketOwner, len(inodes))
	if len(inodes) == 0 {
		return owners
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return owners
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		descriptors, err := os.ReadDir(filepath.Join("/proc", entry.Name(), "fd"))
		if err != nil {
			continue
		}
		for _, descriptor := range descriptors {
			link, err := os.Readlink(filepath.Join("/proc", entry.Name(), "fd", descriptor.Name()))
			if err != nil {
				continue
			}
			inode, ok := socketInodeFromLink(link)
			if !ok {
				continue
			}
			if _, wanted := inodes[inode]; !wanted {
				continue
			}
			if _, known := owners[inode]; !known {
				owners[inode] = socketOwner{pid: pid, name: processName(entry.Name())}
			}
		}
		if len(owners) == len(inodes) {
			break
		}
	}
	return owners
}

type socketOwner struct {
	pid  int
	name string
}

// socketInodeFromLink reads the inode out of an fd symlink like `socket:[12345]`.
func socketInodeFromLink(link string) (string, bool) {
	rest, ok := strings.CutPrefix(link, "socket:[")
	if !ok {
		return "", false
	}
	return strings.CutSuffix(rest, "]")
}

func processName(pid string) string {
	content, err := os.ReadFile(filepath.Join("/proc", pid, "comm"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(content))
}
