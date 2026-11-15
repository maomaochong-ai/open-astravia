import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	atomicWriteJSON: vi.fn(),
	fetch: vi.fn(),
	readFile: vi.fn(),
	send: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@astravia/action-rpc", () => ({ getAstraviaHomePath: () => "C:/test-astravia" }));
vi.mock("@astravia/toolkit/atomic-write", () => ({ atomicWriteJSON: mocks.atomicWriteJSON }));
vi.mock("electron", () => ({
	BrowserWindow: {
		getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
	},
	net: { fetch: mocks.fetch },
}));
vi.mock("../../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("../model-settings-host.js", () => ({
	getDesktopModelSettingsService: () => ({
		getConfig: async () => ({ providers: {} }),
		replaceConfig: vi.fn(),
	}),
}));
vi.mock("./models-dev-snapshot.generated.js", () => ({
	MODELS_DEV_SNAPSHOT: {
		version: 8,
		fetchedAt: "2020-01-01T00:00:00.000Z",
		providers: {},
		lookup: {},
	},
}));

async function flushBackgroundRefresh(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("preset catalog background refresh", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.readFile.mockRejectedValue(Object.assign(new Error("missing cache"), { code: "ENOENT" }));
	});

	it("在线刷新失败并继续使用随包快照时不广播伪更新", async () => {
		mocks.fetch.mockRejectedValue(new Error("network unavailable"));
		const { listPresetProviders } = await import("./sync.js");

		const initial = await listPresetProviders();
		await flushBackgroundRefresh();
		const duringCooldown = await listPresetProviders();
		await flushBackgroundRefresh();

		expect(initial.catalogSource).toBe("snapshot");
		expect(duringCooldown).toMatchObject({ catalogSource: "snapshot", catalogError: { code: "network" } });
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it("在线目录成功替换随包快照时只广播一次更新", async () => {
		mocks.fetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				anthropic: {
					models: {
						"claude-test": { name: "Claude Test", modalities: { output: ["text"] } },
					},
				},
			}),
		});
		const { listPresetProviders } = await import("./sync.js");

		const initial = await listPresetProviders();
		await flushBackgroundRefresh();
		const refreshed = await listPresetProviders();
		await flushBackgroundRefresh();

		expect(initial.catalogSource).toBe("snapshot");
		expect(refreshed.catalogSource).toBe("live");
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(mocks.send).toHaveBeenCalledOnce();
		expect(mocks.send).toHaveBeenCalledWith("astravia:models:presets-updated");
	});

	/**
	 * 本机代理必须在合同里带上预填密钥，渲染层据此派生 `autoKey` 并隐藏「修改密钥」按钮。
	 *
	 * 这是跨进程合同的一部分：主进程漏发时渲染层不会报错，只会让那一行多出一颗钥匙按钮
	 * ——正是这个 bug 的形态（字段名换过一次，旧字段留在主进程时表现完全一致）。
	 */
	it("本机代理带上 defaultApiKey，普通预设不带", async () => {
		const { listPresetProviders } = await import("./sync.js");
		const { providers } = await listPresetProviders();
		const magpie = providers.find((provider) => provider.id === "magpie");

		expect(magpie).toMatchObject({ id: "magpie", defaultApiKey: "magpie" });
		expect(magpie).not.toHaveProperty("localProxy");
		expect(magpie).not.toHaveProperty("autoKey");
		// 普通预设不该被误标成内置密钥，否则它们的密钥按钮会跟着消失。
		for (const provider of providers.filter((entry) => entry.id !== "magpie")) {
			expect(provider).not.toHaveProperty("defaultApiKey");
		}
	});
});
