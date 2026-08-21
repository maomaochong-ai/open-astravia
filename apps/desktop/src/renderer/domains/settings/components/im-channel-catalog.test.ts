import type { ImBridgeConfig, ImTransportSelector } from "@preload/api";
import { describe, expect, it } from "vitest";
import { IM_CHANNELS, isImChannelConfigured } from "./im-channel-catalog";

const ALL_TRANSPORTS: readonly ImTransportSelector[] = [
	"feishu",
	"wechat",
	"telegram",
	"slack",
	"discord",
	"signal",
	"whatsapp",
	"imessage",
];

function emptyConfig(): ImBridgeConfig {
	return {
		enabled: false,
		transport: "feishu",
		feishu: { appId: "", appSecret: "", verificationToken: "", encryptKey: "" },
		wechat: { bound: false },
		telegram: { botToken: "" },
		slack: { botToken: "", appToken: "" },
		discord: { botToken: "" },
		signal: { endpoint: "", account: "" },
		whatsapp: { bound: false },
		imessage: {},
		transportMode: "long-connection",
		encryptionAvailable: true,
	};
}

describe("IM_CHANNELS", () => {
	it("覆盖全部 transport 且不重复", () => {
		expect(IM_CHANNELS.map((channel) => channel.transport).sort()).toEqual([...ALL_TRANSPORTS].sort());
	});

	it("每个渠道有独立图标，避免卡片互相无法区分", () => {
		const icons = IM_CHANNELS.map((channel) => channel.iconClass);
		expect(new Set(icons).size).toBe(icons.length);
	});

	it("只有飞书与微信使用专属配置对话框", () => {
		const byKind = Object.fromEntries(IM_CHANNELS.map((channel) => [channel.transport, channel.dialogKind]));
		expect(byKind.feishu).toBe("feishu");
		expect(byKind.wechat).toBe("wechat");
		expect(byKind.telegram).toBe("generic");
		expect(byKind.imessage).toBe("generic");
	});
});

describe("isImChannelConfigured", () => {
	it("空配置下只有 iMessage 算已配置（读本机数据库，无凭据可配）", () => {
		const config = emptyConfig();
		const configured = ALL_TRANSPORTS.filter((transport) => isImChannelConfigured(config, transport));
		expect(configured).toEqual(["imessage"]);
	});

	it.each([
		["feishu", (c: ImBridgeConfig) => ({ ...c, feishu: { ...c.feishu, appId: "cli_a" } })],
		["wechat", (c: ImBridgeConfig) => ({ ...c, wechat: { bound: true } })],
		["telegram", (c: ImBridgeConfig) => ({ ...c, telegram: { botToken: "tok" } })],
		["discord", (c: ImBridgeConfig) => ({ ...c, discord: { botToken: "tok" } })],
		["whatsapp", (c: ImBridgeConfig) => ({ ...c, whatsapp: { bound: true } })],
	] as const)("%s 凭据齐全后判定为已配置", (transport, fill) => {
		expect(isImChannelConfigured(fill(emptyConfig()), transport)).toBe(true);
	});

	it("Slack 需要 botToken 与 appToken 同时存在", () => {
		const partial = { ...emptyConfig(), slack: { botToken: "xoxb", appToken: "" } };
		expect(isImChannelConfigured(partial, "slack")).toBe(false);
		expect(isImChannelConfigured({ ...partial, slack: { botToken: "xoxb", appToken: "xapp" } }, "slack")).toBe(true);
	});

	it("Signal 需要服务地址与账号同时存在", () => {
		const partial = { ...emptyConfig(), signal: { endpoint: "http://127.0.0.1:8080", account: "" } };
		expect(isImChannelConfigured(partial, "signal")).toBe(false);
		expect(
			isImChannelConfigured({ ...partial, signal: { endpoint: "http://127.0.0.1:8080", account: "+1" } }, "signal"),
		).toBe(true);
	});
});
