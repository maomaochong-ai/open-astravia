package wechat

import "vetta-im-gateway/internal/transport/wechat/ilink"

// CLIStateStore is the subset of the wechat state store that the CLI
// (`im-gateway wechat login|status|logout`) needs. It exists so the CLI
// can manage the persisted credentials file without depending on
// unexported types.
//
// The Transport itself uses the underlying *stateStore directly; this
// interface is purely a facade for the cmd/ package.
type CLIStateStore interface {
	HasCredentials() bool
	Credentials() ilink.Credentials
	SetCredentials(ilink.Credentials) error
	Clear() error
}

// NewStateStoreForCLI opens (or creates) the wechat state store at path
// and returns a CLI-facing handle to it. Reading a missing file is not
// an error; it yields a store with HasCredentials()==false that the
// caller can populate via SetCredentials.
func NewStateStoreForCLI(path string) (CLIStateStore, error) {
	return newStateStore(path)
}
