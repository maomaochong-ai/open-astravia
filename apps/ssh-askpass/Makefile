.PHONY: build test vet tidy lint cross-build dist-clean

BIN_DIR  := bin
DIST_DIR := dist
BINARY   := $(BIN_DIR)/astravia-ssh-askpass
PACKAGE  := ./cmd/astravia-ssh-askpass
LDFLAGS  := -s -w

build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BINARY) $(PACKAGE)

test:
	go test -race -count=1 ./...

vet:
	go vet ./...

tidy:
	go mod tidy

# The desktop app runs askpass.exe locally on Windows; only the windows target is
# shipped. The other targets exist so the build can be exercised on any host.
cross-build:
	@mkdir -p $(DIST_DIR)
	@for target in windows-amd64; do \
		case $$target in \
			windows-amd64) os=windows; arch=amd64;; \
		esac; \
		echo "building $$os/$$arch"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -ldflags "$(LDFLAGS)" -o "$(DIST_DIR)/$$target/astravia-ssh-askpass.exe" $(PACKAGE); \
	done
	@echo "cross-build complete: $(DIST_DIR)/"

dist-clean:
	rm -rf $(DIST_DIR) $(BIN_DIR)
