.PHONY: build test vet tidy lint smoke clean cross-build dist-clean

BIN_DIR  := bin
DIST_DIR := dist
BINARY   := $(BIN_DIR)/vetta-ssh-helper
PACKAGE  := ./cmd/vetta-ssh-helper
# No build version is injected (im-gateway stamps one via -X main.version).
# The helper's identity is internal/protocol.Version: it names the install
# directory on the remote host and is what the handshake checks. Whether the
# bytes need re-uploading is decided by the sha256 the desktop app compares.
# A third, build-shaped version would only disagree with both.
LDFLAGS  := -s -w

build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BINARY) $(PACKAGE)

# -race: every request runs on its own goroutine and task state is read and
# written across requests, so data races are both the easiest mistake to make
# here and the hardest to spot by reading.
# -count=1: skip the test cache, so a green run always means this code ran.
test:
	go test -race -count=1 ./...

vet:
	go vet ./...

tidy:
	go mod tidy

# Requires golangci-lint installed: brew install golangci-lint
lint:
	golangci-lint run ./...

# Smoke check: does the binary we just built answer a handshake? A stdio
# protocol server has nothing else to show without a client; to hand-drive the
# protocol, run `go run $(PACKAGE) serve` and type JSON frames line by line.
smoke: build
	@printf '{"id":1,"method":"hello"}\n' | $(BINARY) serve

clean:
	rm -rf $(BIN_DIR)

# =============================================================================
# Cross-build for remote deployment
# =============================================================================
#
# The helper runs on the REMOTE host of an SSH project, so these targets have
# nothing to do with the desktop platform being built: a macOS build of the app
# still has to carry the linux-arm64 helper for the machines it connects to.
#
# Layout is dist/<os>-<arch>/vetta-ssh-helper rather than im-gateway's flat
# dist/<name>-<os>-<arch>, because the file name is also the name it gets on the
# remote host (installed at ~/.cache/vetta/helper/<protocol version>/
# vetta-ssh-helper). Keeping both identical makes it obvious what was uploaded.
# apps/desktop's helper-assets.ts looks for dev builds in exactly this layout.
#
# CGO is disabled, so the binaries pin neither glibc nor musl: they run on any
# distro, and the remote host needs no runtime installed.
#
# No windows target: task supervision uses setsid and process-group signals
# (internal/server/proc.go), neither of which exists on Windows — GOOS=windows
# does not compile. Remote Windows hosts fall back to plain `ssh exec`.
#
# Note: the binaries inside an installer are cross-built by
# apps/desktop/scripts/prepare-pack.js itself, not by this Makefile (same as
# im-gateway — packaging avoids depending on shell syntax). This target serves
# local development, so the platform list lives in both places;
# scripts/quality/ssh-helper-cross-targets.test.mjs fails if they drift apart.

CROSS_TARGETS := \
	darwin-arm64 \
	darwin-amd64 \
	linux-amd64 \
	linux-arm64

cross-build:
	@for target in $(CROSS_TARGETS); do \
		os=$${target%%-*}; \
		arch=$${target##*-}; \
		out="$(DIST_DIR)/$$os-$$arch/vetta-ssh-helper"; \
		mkdir -p "$(DIST_DIR)/$$os-$$arch"; \
		echo "  → $$out"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -trimpath -ldflags "$(LDFLAGS)" -o $$out $(PACKAGE) || exit 1; \
	done
	@echo "cross-build complete: $(DIST_DIR)/"
	@ls -lh $(DIST_DIR)/*/vetta-ssh-helper

dist-clean:
	rm -rf $(DIST_DIR)
