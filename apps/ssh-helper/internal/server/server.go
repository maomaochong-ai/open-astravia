// Package server implements the helper side of the Vetta remote-project protocol.
package server

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"runtime"
	"sync"
	"time"

	"vetta-ssh-helper/internal/protocol"
)

// maxFrameBytes bounds one request line. File writes arrive base64-encoded in a
// single frame, so this is also the largest file a client can write in one call.
const maxFrameBytes = 96 << 20

type Options struct {
	// StateDir holds task records. It must survive across helper processes.
	StateDir      string
	WatchInterval time.Duration
}

type Server struct {
	stateDir string
	watcher  *watcher
	writeMu  sync.Mutex
	out      *bufio.Writer
	methods  map[string]func(json.RawMessage) (any, *protocol.Error)
}

func New(options Options) *Server {
	interval := options.WatchInterval
	if interval <= 0 {
		interval = 500 * time.Millisecond
	}
	s := &Server{stateDir: options.StateDir}
	s.watcher = newWatcher(interval, func(path string) {
		s.send(protocol.Notification{Method: "watch.changed", Params: map[string]string{"path": path}})
	})
	s.methods = map[string]func(json.RawMessage) (any, *protocol.Error){
		"hello":             bind(s.hello),
		"fs.stat":           bind(fsStat),
		"fs.readDir":        bind(fsReadDir),
		"fs.readFile":       bind(fsReadFile),
		"fs.writeFile":      bind(fsWriteFile),
		"fs.mkdir":          bind(fsMkdir),
		"fs.rename":         bind(fsRename),
		"fs.remove":         bind(fsRemove),
		"fs.createEntry":    bind(fsCreateEntry),
		"fs.realPath":       bind(fsRealPath),
		"fs.listRecursive":  bind(fsListRecursive),
		"watch.subscribe":   bind(s.watcher.subscribe),
		"watch.unsubscribe": bind(s.watcher.unsubscribe),
		"proc.spawn":        bind(s.procSpawn),
		"proc.status":       bind(s.procStatus),
		"proc.list":         bind(s.procList),
		"proc.read":         bind(s.procRead),
		"proc.kill":         bind(s.procKill),
		"proc.remove":       bind(s.procRemove),
	}
	return s
}

// bind adapts a typed handler to the raw-params signature. Absent params decode
// as the zero value, so methods without arguments need no special casing.
func bind[P any](handler func(P) (any, *protocol.Error)) func(json.RawMessage) (any, *protocol.Error) {
	return func(raw json.RawMessage) (any, *protocol.Error) {
		var params P
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &params); err != nil {
				return nil, protocol.Errorf(protocol.CodeInvalid, "invalid params: "+err.Error())
			}
		}
		return handler(params)
	}
}

func (s *Server) hello(_ struct{}) (any, *protocol.Error) {
	home, _ := os.UserHomeDir()
	return map[string]any{
		"protocolVersion": protocol.Version,
		"os":              runtime.GOOS,
		"arch":            runtime.GOARCH,
		"home":            home,
		"pid":             os.Getpid(),
	}, nil
}

// Serve reads requests until the input closes. Each request runs on its own
// goroutine: a long-polling proc.read must not hold up a file read behind it.
func (s *Server) Serve(in io.Reader, out io.Writer) error {
	s.out = bufio.NewWriter(out)
	defer s.watcher.close()
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64<<10), maxFrameBytes)
	var pending sync.WaitGroup
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		if len(line) == 0 {
			continue
		}
		pending.Add(1)
		go func() {
			defer pending.Done()
			s.handle(line)
		}()
	}
	pending.Wait()
	return scanner.Err()
}

func (s *Server) handle(line []byte) {
	var request protocol.Request
	if err := json.Unmarshal(line, &request); err != nil {
		// Without an id there is nothing to correlate a reply with.
		return
	}
	response := protocol.Response{ID: request.ID}
	handler, known := s.methods[request.Method]
	if !known {
		response.Error = protocol.Errorf(protocol.CodeUnknownMethod, "unknown method: "+request.Method)
	} else if result, err := handler(request.Params); err != nil {
		response.Error = err
	} else {
		response.Result = result
	}
	s.send(response)
}

func (s *Server) send(message any) {
	data, err := json.Marshal(message)
	if err != nil {
		return
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, _ = s.out.Write(data)
	_ = s.out.WriteByte('\n')
	_ = s.out.Flush()
}
