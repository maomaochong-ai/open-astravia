package server

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"vetta-ssh-helper/internal/protocol"
)

// watcher reports changes to the directories the file tree has open.
//
// It compares directory listings on an interval instead of using inotify /
// kqueue. That keeps the helper a single static binary with no platform-specific
// code or third-party modules, and it costs almost nothing here: the listing is
// a local syscall, not a network round trip. What this buys over polling from
// the desktop is latency and traffic — one notification when something changed,
// instead of a full listing over SSH every few seconds per open directory.
type watcher struct {
	mu        sync.Mutex
	watched   map[string]string // path -> last fingerprint
	interval  time.Duration
	notify    func(path string)
	stop      chan struct{}
	stopOnce  sync.Once
	startOnce sync.Once
}

func newWatcher(interval time.Duration, notify func(path string)) *watcher {
	return &watcher{watched: map[string]string{}, interval: interval, notify: notify, stop: make(chan struct{})}
}

func (w *watcher) subscribe(p pathParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	print, err := fingerprint(p.Path)
	if err != nil {
		return nil, mapFsError(err)
	}
	w.mu.Lock()
	w.watched[p.Path] = print
	w.mu.Unlock()
	w.startOnce.Do(func() { go w.loop() })
	return map[string]any{}, nil
}

func (w *watcher) unsubscribe(p pathParams) (any, *protocol.Error) {
	w.mu.Lock()
	delete(w.watched, p.Path)
	w.mu.Unlock()
	return map[string]any{}, nil
}

func (w *watcher) close() { w.stopOnce.Do(func() { close(w.stop) }) }

func (w *watcher) loop() {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-w.stop:
			return
		case <-ticker.C:
			w.scan()
		}
	}
}

func (w *watcher) scan() {
	w.mu.Lock()
	paths := make([]string, 0, len(w.watched))
	for path := range w.watched {
		paths = append(paths, path)
	}
	w.mu.Unlock()
	for _, path := range paths {
		// A directory that disappeared is itself a change worth reporting once.
		current, err := fingerprint(path)
		if err != nil {
			current = "!missing"
		}
		w.mu.Lock()
		previous, stillWatched := w.watched[path]
		if stillWatched {
			w.watched[path] = current
		}
		w.mu.Unlock()
		if stillWatched && previous != current {
			w.notify(path)
		}
	}
}

func fingerprint(path string) (string, error) {
	items, err := os.ReadDir(path)
	if err != nil {
		return "", err
	}
	lines := make([]string, 0, len(items))
	for _, item := range items {
		info, err := item.Info()
		if err != nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s\x00%d\x00%d\x00%d", item.Name(), info.Mode(), info.Size(), info.ModTime().UnixNano()))
	}
	sort.Strings(lines)
	return strings.Join(lines, "\n"), nil
}
