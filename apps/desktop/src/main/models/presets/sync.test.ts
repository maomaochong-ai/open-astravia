import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	atomicWriteJSON: vi.fn(),
	fetch: vi.fn(),
	readFile: vi.fn(),
	send: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => "C:/test-vetta" }));
vi.mock("@vetta/toolkit/atomic-write", () => ({ atomicWriteJSON: mocks.atomicWriteJSON }));
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
		version: 7,
		fetchedAt: "2020-01-01T00:00:00.000Z",
		providers: {},
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
		expect(mocks.send).toHaveBeenCalledWith("vetta:models:presets-updated");
	});
});
