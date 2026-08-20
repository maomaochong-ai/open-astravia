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
			feishu: "static",
			wechat: "qr-bind",
			telegram: "static",
			slack: "static",
			discord: "static",
			signal: "static",
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

	it("feishu requires appId in config and appSecret in credentials", () => {
		const d = IM_CHANNEL_DESCRIPTORS.feishu;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(false);
		expect(d.hasRequiredCredentials(configWith({ feishu: { appId: "cli_abc" } }), empty)).toBe(false);
		expect(d.hasRequiredCredentials(configWith(), { feishu: { appSecret: "s" } })).toBe(false);
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

	it("signal requires endpoint and account from config (no secrets)", () => {
		const d = IM_CHANNEL_DESCRIPTORS.signal;
		expect(d.hasRequiredCredentials(configWith(), empty)).toBe(false);
		expect(
			d.hasRequiredCredentials(configWith({ signal: { endpoint: "http://127.0.0.1:8080", account: "" } }), empty),
		).toBe(false);
		expect(
			d.hasRequiredCredentials(
				configWith({ signal: { endpoint: "http://127.0.0.1:8080", account: "+8613800000000" } }),
				empty,
			),
		).toBe(true);
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

	it("signal requires an http(s) endpoint and E.164 account", () => {
		const validate = IM_CHANNEL_DESCRIPTORS.signal.validate;
		expect(validate?.({ endpoint: "http://127.0.0.1:8080", account: "+8613800000000" })).toBeNull();
		expect(validate?.({ endpoint: "", account: "+8613800000000" })).toBeTruthy();
		expect(validate?.({ endpoint: "ftp://x", account: "+8613800000000" })).toBeTruthy();
		expect(validate?.({ endpoint: "https://x", account: "" })).toBeTruthy();
		expect(validate?.({ endpoint: "https://x", account: "13800000000" })).toBeTruthy();
	});
});
