package config

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// stubKeyring replaces keyringGet for the duration of a single test.
// Restored automatically via t.Cleanup.
func stubKeyring(t *testing.T, values map[string]string, hardError error) {
	t.Helper()
	original := keyringGet
	keyringGet = func(key string) (string, error) {
		if hardError != nil {
			return "", hardError
		}
		return values[key], nil
	}
	t.Cleanup(func() { keyringGet = original })
}

func setTestHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	return home
}

func TestLoadCredentials_AllSourcesEmpty(t *testing.T) {
	stubKeyring(t, nil, nil)
	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "")
	setTestHome(t) // ensure no real credentials.yaml interferes

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Feishu.AppID != "" || creds.Feishu.AppSecret != "" {
		t.Errorf("expected empty creds, got %+v", creds.Feishu)
	}
	if creds.Source != "none" {
		t.Errorf("expected source 'none', got %q", creds.Source)
	}
}

func TestLoadCredentials_KeychainOnly(t *testing.T) {
	stubKeyring(t, map[string]string{
		"feishu_app_id":     "kc-app-id",
		"feishu_app_secret": "kc-app-secret",
	}, nil)
	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "")
	setTestHome(t)

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Feishu.AppID != "kc-app-id" || creds.Feishu.AppSecret != "kc-app-secret" {
		t.Errorf("keychain values not picked up: %+v", creds.Feishu)
	}
	if creds.Source != "keychain" {
		t.Errorf("source: want keychain, got %q", creds.Source)
	}
}

func TestLoadCredentials_FileFallback(t *testing.T) {
	stubKeyring(t, nil, nil) // empty keychain

	tempHome := setTestHome(t)
	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "")

	credsDir := filepath.Join(tempHome, ".vetta", "im-gateway")
	if err := os.MkdirAll(credsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	contents := `feishu:
  appId: file-app-id
  appSecret: file-app-secret
`
	if err := os.WriteFile(filepath.Join(credsDir, "credentials.yaml"), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Feishu.AppID != "file-app-id" || creds.Feishu.AppSecret != "file-app-secret" {
		t.Errorf("file values not loaded: %+v", creds.Feishu)
	}
	if creds.Source != "credentials.yaml" {
		t.Errorf("source: want credentials.yaml, got %q", creds.Source)
	}
}

func TestLoadCredentials_EnvOverridesFile(t *testing.T) {
	stubKeyring(t, nil, nil)

	tempHome := setTestHome(t)
	credsDir := filepath.Join(tempHome, ".vetta", "im-gateway")
	if err := os.MkdirAll(credsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	contents := `feishu:
  appId: file-app-id
  appSecret: file-app-secret
`
	if err := os.WriteFile(filepath.Join(credsDir, "credentials.yaml"), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "env-app-id")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "env-app-secret")

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials: %v", err)
	}
	if creds.Feishu.AppID != "env-app-id" || creds.Feishu.AppSecret != "env-app-secret" {
		t.Errorf("env should override file: %+v", creds.Feishu)
	}
	if creds.Source == "" || creds.Source == "credentials.yaml" || creds.Source == "env" {
		// Both file and env contributed; description should reflect both.
		t.Errorf("source should mention merged file+env, got %q", creds.Source)
	}
}

func TestLoadCredentials_PermissionWarning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission bits not meaningful on windows")
	}
	stubKeyring(t, nil, nil)

	tempHome := setTestHome(t)
	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "")

	credsDir := filepath.Join(tempHome, ".vetta", "im-gateway")
	if err := os.MkdirAll(credsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	credsPath := filepath.Join(credsDir, "credentials.yaml")
	if err := os.WriteFile(credsPath, []byte("feishu:\n  appId: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 0o644 has world-readable bit set; loadCredentialsFile should warn but
	// still load the file successfully.
	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("LoadCredentials should not error on wide perms: %v", err)
	}
	if creds.Feishu.AppID != "x" {
		t.Errorf("file should still load despite wide perms, got %+v", creds.Feishu)
	}
}

func TestLoadCredentials_KeychainHardError_FallsThroughSilently(t *testing.T) {
	// On headless / CI systems the keychain is legitimately unreachable.
	// LoadCredentials must NOT fail; it should fall through to env/file
	// (and the keychain wrapper logs a stderr warning for the user).
	hardErr := errors.New("keychain not available")
	stubKeyring(t, nil, hardErr)
	setTestHome(t)
	t.Setenv("IM_GATEWAY_FEISHU_APP_ID", "env-id")
	t.Setenv("IM_GATEWAY_FEISHU_APP_SECRET", "env-secret")

	creds, err := LoadCredentials()
	if err != nil {
		t.Fatalf("hard keychain error should not abort loader: %v", err)
	}
	if creds.Feishu.AppID != "env-id" || creds.Feishu.AppSecret != "env-secret" {
		t.Errorf("env fallback should still work: %+v", creds.Feishu)
	}
}
