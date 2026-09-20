.PHONY: build test vet cross-build clean

BIN_DIR  := bin
DIST_DIR := dist
PACKAGE  := ./cmd/vetta-ssh-helper
LDFLAGS  := -s -w
# Every target the desktop app can upload to. Add one here and in
# apps/desktop's helper asset resolver together.
TARGETS  := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64

build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/vetta-ssh-helper $(PACKAGE)

test:
	go test -race -count=1 ./...

vet:
	go vet ./...

# Static binaries, one per remote platform: dist/<os>-<arch>/vetta-ssh-helper.
# CGO is off so the result runs on any libc (glibc, musl) without a runtime.
cross-build:
	@for target in $(TARGETS); do \
		os=$${target%/*}; arch=$${target#*/}; \
		mkdir -p $(DIST_DIR)/$$os-$$arch; \
		echo "building $$os-$$arch"; \
		GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" \
			-o $(DIST_DIR)/$$os-$$arch/vetta-ssh-helper $(PACKAGE) || exit 1; \
	done

clean:
	rm -rf $(BIN_DIR) $(DIST_DIR)
