package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/zalando/go-keyring"
	"gopkg.in/yaml.v3"
)

// Keychain service identifier. The same string is used for every secret the
// gateway stores so listing the keychain entries is easy for users.
const keychainService = "vetta-im-gateway"

// File credentials live alongside config.yaml. Loaded only when keychain is
// unavailable or empty for a given key.
const credentialsFilename = "credentials.yaml"

// credentialsFileShape mirrors the YAML schema. Kept private so callers
// can't accidentally couple to the on-disk format.
type credentialsFileShape struct {
	Feishu struct {
		AppID     string `yaml:"appId"`
		AppSecret string `yaml:"appSecret"`
	} `yaml:"feishu"`
}

// loadCredentials assembles credentials from the three sources documented
// in the Credentials type comment. Order: keychain → credentials.yaml →
// environment variables. Later sources overwrite earlier ones, and Source
// records the most-authoritative source that actually contributed.
//
// A field that is empty after all three sources is considered missing; the
// gateway will fail later when the transport that needs it tries to start.
// We deliberately do not error here on missing values, because the mock
// transport doesn't need any credentials at all.
func loadCredentials() (*Credentials, error) {
	creds := &Credentials{}

	// 1. Keychain. On headless / CI systems the keychain may be entirely
	// unavailable; we treat any non-ErrNotFound failure as "no keychain
	// here" rather than propagating, because the file/env fallback chain is
	// designed exactly for that case. Hard failures are still surfaced to
	// stderr so users can investigate if they expected keychain to work.
	keychainContributed := false
	if v, err := tryKeychain("feishu_app_id"); err == nil && v != "" {
		creds.Feishu.AppID = v
		keychainContributed = true
	}
	if v, err := tryKeychain("feishu_app_secret"); err == nil && v != "" {
		creds.Feishu.AppSecret = v
		keychainContributed = true
	}

	// 2. credentials.yaml
	fileContributed := false
	credsPath, err := defaultCredentialsPath()
	if err != nil {
		return nil, err
	}
	if file, ok, err := loadCredentialsFile(credsPath); err != nil {
		return nil, err
	} else if ok {
		fileContributed = true
		if creds.Feishu.AppID == "" {
			creds.Feishu.AppID = file.Feishu.AppID
		}
		if creds.Feishu.AppSecret == "" {
			creds.Feishu.AppSecret = file.Feishu.AppSecret
		}
	}

	// 3. Environment
	envContributed := false
	if v := os.Getenv("IM_GATEWAY_FEISHU_APP_ID"); v != "" {
		creds.Feishu.AppID = v
		envContributed = true
	}
	if v := os.Getenv("IM_GATEWAY_FEISHU_APP_SECRET"); v != "" {
		creds.Feishu.AppSecret = v
		envContributed = true
	}

	creds.Source = describeSources(keychainContributed, fileContributed, envContributed)
	return creds, nil
}

func describeSources(keychain, file, env bool) string {
	switch {
	case keychain && file && env:
		return "merged (keychain + file + env)"
	case file && env:
		return "merged (file + env)"
	case keychain && env:
		return "merged (keychain + env)"
	case keychain && file:
		return "merged (keychain + file)"
	case env:
		return "env"
	case file:
		return "credentials.yaml"
	case keychain:
		return "keychain"
	default:
		return "none"
	}
}

func defaultCredentialsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".vetta", "im-gateway", credentialsFilename), nil
}

// loadCredentialsFile returns (file, true, nil) when the file exists and was
// parsed successfully; (zero, false, nil) when the file does not exist;
// (zero, false, err) on parse / permission errors.
//
// Also warns (via stderr, since logger isn't initialized this early) when
// the file's permission bits are wider than 0600.
func loadCredentialsFile(path string) (credentialsFileShape, bool, error) {
	var out credentialsFileShape

	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return out, false, nil
		}
		return out, false, fmt.Errorf("stat %s: %w", path, err)
	}

	// Permission check is POSIX-only. On Windows os.FileMode bits do not
	// reflect ACLs accurately so we skip the warning there.
	if runtime.GOOS != "windows" {
		mode := info.Mode().Perm()
		if mode&0o077 != 0 {
			fmt.Fprintf(
				os.Stderr,
				"warning: %s has permissions %o; recommended 0600 (chmod 0600 %s)\n",
				path, mode, path,
			)
		}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return out, false, fmt.Errorf("read %s: %w", path, err)
	}
	if err := yaml.Unmarshal(raw, &out); err != nil {
		return out, false, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, true, nil
}

// keyringGet wraps go-keyring with error suppression for the common
// "key not found" case so callers can treat absence as "no value".
//
// The keyring library returns keyring.ErrNotFound for missing keys; that
// gets translated to a nil error with empty value here so the loader chain
// can simply check `v != ""`. Other errors (locked keychain, permission
// denied, "keychain not available" on headless boxes) propagate.
//
// Tests inject a fake by reassigning this var.
var keyringGet = func(key string) (string, error) {
	v, err := keyring.Get(keychainService, key)
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return "", nil
		}
		return "", err
	}
	return v, nil
}

// tryKeychain calls keyringGet but swallows non-ErrNotFound errors after
// logging them to stderr. This is the right behavior at the loader level
// because on headless/CI systems the keychain is legitimately unreachable
// and we want to fall through to file/env rather than fail the entire
// startup. The stderr warning ensures users who *expected* keychain to
// work can investigate.
func tryKeychain(key string) (string, error) {
	v, err := keyringGet(key)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: keychain unavailable for %s: %v\n", key, err)
		return "", nil
	}
	return v, nil
}
