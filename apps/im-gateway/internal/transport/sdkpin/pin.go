// Package sdkpin temporarily pins the platform SDK modules used by the
// in-progress channel adapters (discord / slack / whatsapp / imessage) so
// `go mod tidy` keeps them in go.mod while the adapters are being written
// in parallel. Delete this package once every adapter imports its SDK
// directly.
package sdkpin

import (
	_ "github.com/bwmarrin/discordgo"
	_ "github.com/slack-go/slack"
	_ "go.mau.fi/whatsmeow"
	_ "modernc.org/sqlite"
)
