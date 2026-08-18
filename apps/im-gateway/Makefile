.PHONY: build test run lint vet tidy clean cross-build dist-clean

BIN_DIR  := bin
DIST_DIR := dist
BINARY   := $(BIN_DIR)/im-gateway
VERSION  ?= dev
LDFLAGS  := -s -w -X main.version=$(VERSION)

build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/im-gateway

test:
	go test ./...

# Run with mock transport for local development
run:
	go run ./cmd/im-gateway start --transport mock

vet:
	go vet ./...

tidy:
	go mod tidy

# Requires golangci-lint installed: brew install golangci-lint
lint:
	golangci-lint run ./...

clean:
	rm -rf $(BIN_DIR) tmp coverage.out

# =============================================================================
# Cross-build for desktop-app sidecar packaging
# =============================================================================
#
# Produces statically linked binaries for every platform desktop-app ships
# to. Output goes under dist/im-gateway-<os>-<arch>[.exe]; electron-builder
# picks them up via extraResources at packaging time.
#
# CGO is disabled so the resulting binaries have no glibc / musl pinning,
# making them portable across distros and arch combinations.

CROSS_TARGETS := \
	darwin-arm64 \
	darwin-amd64 \
	linux-amd64 \
	linux-arm64 \
	windows-amd64

cross-build:
	@mkdir -p $(DIST_DIR)
	@for target in $(CROSS_TARGETS); do \
		os=$${target%%-*}; \
		arch=$${target##*-}; \
		ext=""; \
		if [ "$$os" = "windows" ]; then ext=".exe"; fi; \
		out="$(DIST_DIR)/im-gateway-$$os-$$arch$$ext"; \
		echo "  → $$out"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -trimpath -ldflags "$(LDFLAGS)" -o $$out ./cmd/im-gateway || exit 1; \
	done
	@echo "cross-build complete: $(DIST_DIR)/"
	@ls -lh $(DIST_DIR)/

dist-clean:
	rm -rf $(DIST_DIR)
