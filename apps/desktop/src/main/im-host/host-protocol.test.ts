import { describe, expect, it } from "vitest";
import { decodeEvent, encodeFrame, type InitFrame } from "./host-protocol.js";

describe("decodeEvent", () => {
	it("returns null for empty lines", () => {
		expect(decodeEvent("")).toBeNull();
		expect(decodeEvent("   \n")).toBeNull();
	});

	it("decodes the four whatsapp bind-flow events", () => {
		expect(decodeEvent(JSON.stringify({ type: "whatsapp_qr", code: "pairing-code", attempt: 2 }))).toEqual({
			type: "whatsapp_qr",
			code: "pairing-code",
			attempt: 2,
		});
		expect(decodeEvent(JSON.stringify({ type: "whatsapp_bind_status", status: "failed", error: "boom" }))).toEqual({
			type: "whatsapp_bind_status",
			status: "failed",
			error: "boom",
		});
		expect(decodeEvent(JSON.stringify({ type: "whatsapp_bound", jid: "user@s.whatsapp.net" }))).toEqual({
			type: "whatsapp_bound",
			jid: "user@s.whatsapp.net",
		});
		expect(decodeEvent(JSON.stringify({ type: "whatsapp_unbound", reason: "logout" }))).toEqual({
			type: "whatsapp_unbound",
			reason: "logout",
		});
	});

	it("still decodes the wechat bind-flow events", () => {
		expect(decodeEvent(JSON.stringify({ type: "wechat_qr", url: "https://x", attempt: 1 }))).toEqual({
			type: "wechat_qr",
			url: "https://x",
			attempt: 1,
		});
		expect(decodeEvent(JSON.stringify({ type: "wechat_unbound" }))).toEqual({ type: "wechat_unbound" });
	});

	it("decodes the four feishu registration events", () => {
		expect(decodeEvent(JSON.stringify({ type: "feishu_qr", url: "https://x", expireIn: 600, attempt: 1 }))).toEqual({
			type: "feishu_qr",
			url: "https://x",
			expireIn: 600,
			attempt: 1,
		});
		expect(decodeEvent(JSON.stringify({ type: "feishu_bind_status", status: "expired" }))).toEqual({
			type: "feishu_bind_status",
			status: "expired",
		});
		// The credentials ride on this one event and must survive intact.
		expect(
			decodeEvent(
				JSON.stringify({
					type: "feishu_bound",
					appId: "cli_abc",
					appSecret: "sec",
					tenantBrand: "lark",
					openId: "ou_1",
				}),
			),
		).toEqual({ type: "feishu_bound", appId: "cli_abc", appSecret: "sec", tenantBrand: "lark", openId: "ou_1" });
		expect(decodeEvent(JSON.stringify({ type: "feishu_unbound", reason: "user logout" }))).toEqual({
			type: "feishu_unbound",
			reason: "user logout",
		});
	});

	it("throws on unknown event types and missing discriminators", () => {
		expect(() => decodeEvent(JSON.stringify({ type: "telegram_qr" }))).toThrow(/unknown event type/);
		expect(() => decodeEvent(JSON.stringify({ code: "x" }))).toThrow(/missing type/);
	});
});

describe("encodeFrame", () => {
	it("serializes whatsapp inbound frames as NDJSON lines", () => {
		expect(encodeFrame({ type: "whatsapp_bind_start" })).toBe('{"type":"whatsapp_bind_start"}\n');
		expect(encodeFrame({ type: "whatsapp_logout" })).toBe('{"type":"whatsapp_logout"}\n');
		expect(encodeFrame({ type: "feishu_bind_start" })).toBe('{"type":"feishu_bind_start"}\n');
		expect(encodeFrame({ type: "feishu_logout" })).toBe('{"type":"feishu_logout"}\n');
	});

	it("carries the six new channel slots on an init frame", () => {
		const frame: InitFrame = {
			type: "init",
			telegram: { botToken: "123:abc", allowedUserIds: [1] },
			slack: { botToken: "xoxb-1", appToken: "xapp-1", allowedChannelIds: ["C1"] },
			discord: { botToken: "tok", allowedGuildIds: ["g"] },
			signal: { endpoint: "http://127.0.0.1:8080", account: "+861", attachmentsDir: "/tmp/a" },
			whatsapp: { enabled: true, statePath: "/tmp/wa.db", allowedNumbers: ["+862"] },
			imessage: { enabled: true, dbPath: "/tmp/chat.db", allowedHandles: ["h"] },
			conversationCwd: "/tmp/conv",
			state: [],
		};
		const decoded = JSON.parse(encodeFrame(frame)) as InitFrame;
		expect(decoded).toEqual(frame);
	});
});
