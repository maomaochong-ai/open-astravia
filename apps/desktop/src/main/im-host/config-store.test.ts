import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IM_TRANSPORT_SELECTORS } from "./channels.js";
import { defaultImConfig, type ImConfig, loadImConfig, saveImConfig } from "./config-store.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "im-config-store-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeConfigFile(value: unknown): string {
	const filePath = join(dir, "im-config.json");
	writeFileSync(filePath, JSON.stringify(value), "utf-8");
	return filePath;
}

describe("defaultImConfig", () => {
	it("has all 8 channel slots with safe defaults", () => {
		const config = defaultImConfig();
		expect(config).toEqual({
			enabled: false,
			transport: "feishu",
			feishu: { appId: "" },
			wechat: { bound: false },
			telegram: {},
			slack: {},
			discord: {},
			signal: { bound: false },
			whatsapp: { bound: false },
			imessage: {},
			transportMode: "long-connection",
		});
	});
});

describe("loadImConfig transport normalization", () => {
	it("accepts every known transport selector", () => {
		for (const transport of IM_TRANSPORT_SELECTORS) {
			const filePath = writeConfigFile({ ...defaultImConfig(), transport });
			expect(loadImConfig(filePath).transport).toBe(transport);
		}
	});

	it("falls back to feishu on unknown or missing transport values", () => {
		expect(loadImConfig(writeConfigFile({ transport: "qq" })).transport).toBe("feishu");
		expect(loadImConfig(writeConfigFile({ transport: 3 })).transport).toBe("feishu");
		expect(loadImConfig(writeConfigFile({})).transport).toBe("feishu");
	});

	it("returns defaults for missing or malformed files", () => {
		expect(loadImConfig(join(dir, "does-not-exist.json"))).toEqual(defaultImConfig());
		const filePath = join(dir, "broken.json");
		writeFileSync(filePath, "{not json", "utf-8");
		expect(loadImConfig(filePath)).toEqual(defaultImConfig());
	});
});

describe("channel slot round-trip", () => {
	it("persists and reloads all new channel slots", () => {
		const config: ImConfig = {
			...defaultImConfig(),
			transport: "slack",
			telegram: { allowedUserIds: [123, 456] },
			slack: { allowedUserIds: ["U1"], allowedChannelIds: ["C1", "C2"] },
			discord: { allowedUserIds: ["u1"], allowedGuildIds: ["g1"] },
			signal: {
				bound: true,
				endpoint: "http://127.0.0.1:8080",
				account: "+8613800000000",
				allowedNumbers: ["+8613900000000"],
				attachmentsDir: "/tmp/signal-attachments",
			},
			whatsapp: { bound: true, allowedNumbers: ["+8613700000000"] },
			imessage: { dbPath: "/Users/x/Library/Messages/chat.db", allowedHandles: ["a@b.c"] },
		};
		const filePath = join(dir, "im-config.json");
		saveImConfig(config, filePath);
		expect(loadImConfig(filePath)).toEqual(config);
	});

	it("drops malformed slot values instead of propagating them", () => {
		const filePath = writeConfigFile({
			telegram: { allowedUserIds: ["not-a-number", 7] },
			slack: { allowedUserIds: "U1" },
			signal: { endpoint: 42, account: null, cliPath: 7, allowedNumbers: [] },
			whatsapp: { bound: "yes", allowedNumbers: [1, "+86"] },
			imessage: { dbPath: "", allowedHandles: [null] },
		});
		const loaded = loadImConfig(filePath);
		expect(loaded.telegram.allowedUserIds).toEqual([7]);
		expect(loaded.slack.allowedUserIds).toBeUndefined();
		expect(loaded.signal).toEqual({
			bound: false,
			endpoint: undefined,
			account: undefined,
			cliPath: undefined,
			allowedNumbers: undefined,
			attachmentsDir: undefined,
		});
		expect(loaded.whatsapp).toEqual({ bound: true, allowedNumbers: ["+86"] });
		expect(loaded.imessage).toEqual({});
	});

	it("still round-trips the legacy feishu / wechat fields", () => {
		const config: ImConfig = {
			...defaultImConfig(),
			enabled: true,
			transport: "wechat",
			feishu: { appId: "cli_abc", baseUrl: "https://open.feishu.cn" },
			wechat: { bound: true, ilinkBotId: "bot", ilinkUserId: "user" },
			agentModel: { provider: "anthropic", model: "some-model" },
		};
		const filePath = join(dir, "im-config.json");
		saveImConfig(config, filePath);
		expect(loadImConfig(filePath)).toEqual(config);
	});
});
