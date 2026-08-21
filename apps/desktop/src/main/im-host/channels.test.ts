import { describe, expect, it } from "vitest";
import {
	getImChannelDescriptor,
	IM_CHANNEL_DESCRIPTORS,
	IM_TRANSPORT_SELECTORS,
	type ImTransportSelector,
	isImTransportSelector,
} from "./channels.js";
import { defaultImConfig, type ImConfig } from "./config-store.js";
import type { ImCredentials } from "./credential-store.js";

function configWith(overrides: Partial<ImConfig> = {}): ImConfig {
	return { ...defaultImConfig(), ...overrides };
}

describe("IM_TRANSPORT_SELECTORS / isImTransportSelector", () => {
	it("contains the 8 supported channels", () => {
		expect([...IM_TRANSPORT_SELECTORS]).toEqual([
			"feishu",
			"wechat",
			"telegram",
			"slack",
			"discord",
			"signal",
			"whatsapp",
			"imessage",
		]);
	});

	it("accepts every selector and rejects unknown / non-string values", () => {
		for (const selector of IM_TRANSPORT_SELECTORS) {
			expect(isImTransportSelector(selector)).toBe(true);
		}
		expect(isImTransportSelector("qq")).toBe(false);
		expect(isImTransportSelector("")).toBe(false);
		expect(isImTransportSelector(undefined)).toBe(false);
		expect(isImTransportSelector(42)).toBe(false);
	});
});

describe("IM_CHANNEL_DESCRIPTORS", () => {
	it("has one descriptor per selector with a matching id", () => {
		for (const selector of IM_TRANSPORT_SELECTORS) {
			const descriptor = getImChannelDescriptor(selector);
			expect(descriptor).toBeDefined();
			expect(descriptor.id).toBe(selector);
		}
		expect(Object.keys(IM_CHANNEL_DESCRIPTORS).sort()).toEqual([...IM_TRANSPORT_SELECTORS].sort());
	});

	it("assigns the expected credentialKind to each channel", () => {
		const kinds: Record<ImTransportSelector, string> = {
			feishu: "scan-or-static",
			wechat: "qr-bind",
			telegram: "static",
			slack: "static",
			discord: "static",
			signal: "qr-bind",
			whatsapp: "qr-bind",
			imessage: "local-permission",
		};
		for (const selector of IM_TRANSPORT_SELECTORS) {
			expect(IM_CHANNEL_DESCRIPTORS[selector].credentialKind).toBe(kinds[selector]);
		}
	});
});

describe("hasRequiredCredentials", () => {
	const empty: ImCredentials = {};

	// Feishu is startable with nothing configured: the sidecar parks in
	// awaiting_bind, which is where the one-click registration scan runs.
	it("feishu is startable with or without credentials", () => {
		const d = IM_CHANNEL_DESCRIPTORS.feishu;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(true);
		expect(
			d.hasRequiredCredentials(configWith({ feishu: { appId: "cli_abc" } }), { feishu: { appSecret: "s" } }),
		).toBe(true);
	});

	it("telegram requires a bot token", () => {
		const d = IM_CHANNEL_DESCRIPTORS.telegram;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { telegram: { botToken: "" } })).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { telegram: { botToken: "123:abc" } })).toBe(true);
	});

	it("slack requires both bot token and app token", () => {
		const d = IM_CHANNEL_DESCRIPTORS.slack;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { slack: { botToken: "xoxb-1", appToken: "" } })).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { slack: { botToken: "", appToken: "xapp-1" } })).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { slack: { botToken: "xoxb-1", appToken: "xapp-1" } })).toBe(true);
	});

	it("discord requires a bot token", () => {
		const d = IM_CHANNEL_DESCRIPTORS.discord;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { discord: { botToken: "tok" } })).toBe(true);
	});

	it("signal is startable in managed mode, and needs an account only with a user-run daemon", () => {
		const d = IM_CHANNEL_DESCRIPTORS.signal;
		// Managed mode: the sidecar links the device itself, so an empty
		// config is enough to boot into awaiting_bind.
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(true);
		expect(
			d.hasRequiredCredentials(configWith({ signal: { bound: false, endpoint: "http://127.0.0.1:8080" } }), empty),
		).toBe(false);
		expect(
			d.hasRequiredCredentials(
				configWith({ signal: { bound: false, endpoint: "http://127.0.0.1:8080", account: "+8613800000000" } }),
				empty,
			),
		).toBe(true);
	});

	it("signal validation accepts managed mode and rejects a half-filled daemon config", () => {
		const d = IM_CHANNEL_DESCRIPTORS.signal;
		expect(d.validate?.({ transport: "signal" })).toBeNull();
		expect(d.validate?.({ transport: "signal", endpoint: "127.0.0.1:8080", account: "+1234567" })).toContain("http");
		expect(d.validate?.({ transport: "signal", endpoint: "http://127.0.0.1:8080" })).toContain("账号");
		expect(d.validate?.({ transport: "signal", account: "not-a-number" })).toContain("E.164");
	});

	it("qr-bind and local-permission channels are always startable", () => {
		for (const selector of ["wechat", "whatsapp", "imessage"] as const) {
			expect(IM_CHANNEL_DESCRIPTORS[selector].hasRequiredCredentials(configWith(), empty)).toBe(true);
		}
	});
});

describe("validate", () => {
	it("is defined exactly for the channels with testable static fields", () => {
		for (const selector of ["feishu", "telegram", "slack", "discord", "signal"] as const) {
			expect(IM_CHANNEL_DESCRIPTORS[selector].validate).toBeTypeOf("function");
		}
		for (const selector of ["wechat", "whatsapp", "imessage"] as const) {
			expect(IM_CHANNEL_DESCRIPTORS[selector].validate).toBeUndefined();
		}
	});

	it("feishu accepts a cli_ appId + secret and rejects bad shapes", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.feishu.validate;
		expect(validate?.({ appId: "cli_abc123", appSecret: "s" })).toBeNull();
		expect(validate?.({ appId: "", appSecret: "s" })).toBeTruthy();
		expect(validate?.({ appId: "cli_abc", appSecret: "" })).toBeTruthy();
		expect(validate?.({ appId: "not-cli", appSecret: "s" })).toBeTruthy();
	});

	it("telegram accepts <digits>:<key> tokens and rejects others", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.telegram.validate;
		expect(validate?.({ botToken: "123456:ABC-def_ghi" })).toBeNull();
		expect(validate?.({ botToken: "" })).toBeTruthy();
		expect(validate?.({ botToken: "no-colon" })).toBeTruthy();
	});

	it("slack requires xoxb-/xapp- prefixed tokens", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.slack.validate;
		expect(validate?.({ botToken: "xoxb-1", appToken: "xapp-1" })).toBeNull();
		expect(validate?.({ botToken: "", appToken: "xapp-1" })).toBeTruthy();
		expect(validate?.({ botToken: "bad", appToken: "xapp-1" })).toBeTruthy();
		expect(validate?.({ botToken: "xoxb-1", appToken: "" })).toBeTruthy();
		expect(validate?.({ botToken: "xoxb-1", appToken: "bad" })).toBeTruthy();
	});

	it("discord only requires a non-empty bot token", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.discord.validate;
		expect(validate?.({ botToken: "any-token" })).toBeNull();
		expect(validate?.({ botToken: "  " })).toBeTruthy();
		expect(validate?.({})).toBeTruthy();
	});

	// Managed mode (both fields empty) is the default and needs no input;
	// a user-run daemon still has to be described completely.
	it("signal accepts managed mode and validates a user-run daemon config", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.signal.validate;
		expect(validate?.({})).toBeNull();
		expect(validate?.({ endpoint: "http://127.0.0.1:8080", account: "+8613800000000" })).toBeNull();
		expect(validate?.({ endpoint: "ftp://x", account: "+8613800000000" })).toBeTruthy();
		expect(validate?.({ endpoint: "https://x", account: "" })).toBeTruthy();
		expect(validate?.({ endpoint: "https://x", account: "13800000000" })).toBeTruthy();
	});
});

describe("clearConfig / clearCredentials", () => {
	// 解除绑定的核心不变量：只清掉自己那一格，别的渠道原样保留。
	function populated(): ImConfig {
		return {
			...configWith(),
			feishu: { appId: "cli_a", baseUrl: "https://open.feishu.cn" },
			wechat: { bound: true, ilinkBotId: "bot" },
			telegram: { allowedUserIds: [7] },
			slack: { allowedUserIds: ["U1"], allowedChannelIds: ["C1"] },
			discord: { allowedUserIds: ["u1"], allowedGuildIds: ["g1"] },
			signal: { bound: true, account: "+8613800000000" },
			whatsapp: { bound: true, allowedNumbers: ["+1"] },
			imessage: { dbPath: "/tmp/chat.db", allowedHandles: ["a@b.c"] },
		};
	}

	function populatedCredentials(): ImCredentials {
		return {
			feishu: { appSecret: "s" },
			telegram: { botToken: "t" },
			slack: { botToken: "xoxb", appToken: "xapp" },
			discord: { botToken: "d" },
		};
	}

	it.each(IM_TRANSPORT_SELECTORS)("%s 清空后不再具备启动条件（qr-bind 除外）", (transport) => {
		const d = IM_CHANNEL_DESCRIPTORS[transport];
		const config = d.clearConfig(populated());
		const credentials = d.clearCredentials(populatedCredentials());
		const startable = d.hasRequiredCredentials(config, credentials);
		// 扫码类与本机权限类清空后仍可启动：sidecar 会停在 awaiting_bind。
		expect(startable).toBe(d.credentialKind !== "static");
	});

	it.each(IM_TRANSPORT_SELECTORS)("%s 清空不会波及其它渠道", (transport) => {
		const before = populated();
		const config = IM_CHANNEL_DESCRIPTORS[transport].clearConfig(before);
		for (const other of IM_TRANSPORT_SELECTORS) {
			if (other === transport) continue;
			expect(config[other], other).toEqual(before[other]);
		}
		expect(config.enabled).toBe(before.enabled);
		expect(config.transport).toBe(before.transport);
	});

	it("清空凭据只删自己那一份", () => {
		const rest = IM_CHANNEL_DESCRIPTORS.slack.clearCredentials(populatedCredentials());
		expect(rest.slack).toBeUndefined();
		expect(rest.feishu?.appSecret).toBe("s");
		expect(rest.telegram?.botToken).toBe("t");
		expect(rest.discord?.botToken).toBe("d");
	});

	it("扫码类渠道清空的是绑定标记", () => {
		expect(IM_CHANNEL_DESCRIPTORS.wechat.clearConfig(populated()).wechat).toEqual({ bound: false });
		expect(IM_CHANNEL_DESCRIPTORS.whatsapp.clearConfig(populated()).whatsapp).toEqual({ bound: false });
		expect(IM_CHANNEL_DESCRIPTORS.signal.clearConfig(populated()).signal).toEqual({ bound: false });
	});
});
