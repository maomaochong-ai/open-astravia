package main

import (
	"errors"
	"fmt"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/discord"
	"vetta-im-gateway/internal/transport/feishu"
	"vetta-im-gateway/internal/transport/imessage"
	signalcli "vetta-im-gateway/internal/transport/signal"
	"vetta-im-gateway/internal/transport/slack"
	"vetta-im-gateway/internal/transport/telegram"
	"vetta-im-gateway/internal/transport/wechat"
)

// hostChannel binds one InitFrame slot to its transport constructor.
//
// selected reports whether the parent asked for this channel; build turns
// the spec into a live transport. Adding a channel means adding a row to
// hostChannels — buildHostTransport itself never grows a branch.
type hostChannel struct {
	name     string
	selected func(*buildSpec) bool
	build    func(*buildSpec) (transport.Transport, error)
}

// hostChannels is the ordered channel table. Order decides precedence when
// the parent (incorrectly) populates more than one slot: pairing-based
// channels come first so a stale static credential can never shadow an
// active pairing session.
var hostChannels = []hostChannel{
	{
		name:     "wechat",
		selected: func(s *buildSpec) bool { return s.Wechat != nil && s.Wechat.Enabled },
		build: func(s *buildSpec) (transport.Transport, error) {
			tr, err := wechat.New(wechat.Options{
				StatePath: s.WechatStatePath,
				InboxDir:  s.ConversationCwd,
			})
			if err != nil {
				if errors.Is(err, wechat.ErrNotBound) {
					return nil, errAwaitingBind
				}
				return nil, fmt.Errorf("build wechat transport: %w", err)
			}
			return tr, nil
		},
	},
	{
		name:     "feishu",
		selected: func(s *buildSpec) bool { return s.Feishu != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Feishu.AppID == "" || s.Feishu.AppSecret == "" {
				return nil, errors.New("feishu config missing AppID/AppSecret")
			}
			return feishu.New(feishu.Options{
				AppID:     s.Feishu.AppID,
				AppSecret: s.Feishu.AppSecret,
				Domain:    s.Feishu.BaseURL,
				InboxDir:  s.ConversationCwd,
			})
		},
	},
	{
		name:     "telegram",
		selected: func(s *buildSpec) bool { return s.Telegram != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Telegram.BotToken == "" {
				return nil, errors.New("telegram config missing botToken")
			}
			return telegram.New(telegram.Options{
				BotToken:       s.Telegram.BotToken,
				AllowedUserIDs: s.Telegram.AllowedUserIDs,
				InboxDir:       s.ConversationCwd,
			})
		},
	},
	{
		name:     "slack",
		selected: func(s *buildSpec) bool { return s.Slack != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Slack.BotToken == "" || s.Slack.AppToken == "" {
				return nil, errors.New("slack config missing botToken/appToken")
			}
			return slack.New(slack.Options{
				BotToken:          s.Slack.BotToken,
				AppToken:          s.Slack.AppToken,
				AllowedUserIDs:    s.Slack.AllowedUserIDs,
				AllowedChannelIDs: s.Slack.AllowedChannelIDs,
				InboxDir:          s.ConversationCwd,
			})
		},
	},
	{
		name:     "discord",
		selected: func(s *buildSpec) bool { return s.Discord != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Discord.BotToken == "" {
				return nil, errors.New("discord config missing botToken")
			}
			return discord.New(discord.Options{
				BotToken:        s.Discord.BotToken,
				AllowedUserIDs:  s.Discord.AllowedUserIDs,
				AllowedGuildIDs: s.Discord.AllowedGuildIDs,
				InboxDir:        s.ConversationCwd,
			})
		},
	},
	{
		name:     "signal",
		selected: func(s *buildSpec) bool { return s.Signal != nil },
		build: func(s *buildSpec) (transport.Transport, error) {
			if s.Signal.Endpoint == "" || s.Signal.Account == "" {
				return nil, errors.New("signal config missing endpoint/account")
			}
			return signalcli.New(signalcli.Options{
				Endpoint:       s.Signal.Endpoint,
				Account:        s.Signal.Account,
				AllowedNumbers: s.Signal.AllowedNumbers,
				AttachmentsDir: s.Signal.AttachmentsDir,
				InboxDir:       s.ConversationCwd,
			})
		},
	},
	{
		name:     "imessage",
		selected: func(s *buildSpec) bool { return s.IMessage != nil && s.IMessage.Enabled },
		build: func(s *buildSpec) (transport.Transport, error) {
			return imessage.New(imessage.Options{
				DBPath:         s.IMessage.DBPath,
				AllowedHandles: s.IMessage.AllowedHandles,
				InboxDir:       s.ConversationCwd,
			})
		},
	},
}

// buildHostTransport constructs the IM transport from the supplied build
// spec by consulting hostChannels in order.
//
// Returns errAwaitingBind when a pairing-based channel is selected but no
// credentials have been persisted yet — the host runtime catches this and
// parks the sidecar in awaiting_bind mode instead of failing init.
func buildHostTransport(spec *buildSpec) (transport.Transport, error) {
	if spec == nil {
		return nil, errors.New("build spec missing")
	}
	for _, ch := range hostChannels {
		if ch.selected(spec) {
			return ch.build(spec)
		}
	}
	return nil, errors.New("build spec selects no transport")
}
