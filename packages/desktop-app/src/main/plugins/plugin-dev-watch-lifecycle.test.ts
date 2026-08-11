import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	resolveCli: vi.fn(() => "C:/plugin/node_modules/@vetta-org/plugin-vite/dist/cli.js"),
	setLink: vi.fn(),
	setServer: vi.fn(),
	setStatus: vi.fn(),
	deactivateLink: vi.fn(),
	clearLink: vi.fn(),
	refreshLink: vi.fn(),
	reconfigureAgentPlugins: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("./plugin-dev-cli.js", () => ({ resolvePluginDevCliPath: mocks.resolveCli }));
vi.mock("./plugin-store.js", () => ({
	buildAgentPluginRuntimeConfig: () => ({}),
	clearPluginDevLink: mocks.clearLink,
	deactivatePluginDevLink: mocks.deactivateLink,
	refreshPluginDevLink: mocks.refreshLink,
	setPluginDevLink: mocks.setLink,
	setPluginDevLinkServer: mocks.setServer,
	setPluginDevLinkStatus: mocks.setStatus,
}));
vi.mock("../runtime.js", () => ({
	getSharedRuntime: () => ({ reconfigureAgentPlugins: mocks.reconfigureAgentPlugins }),
}));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import { startPluginDevWatch, stopAllPluginDevWatches } from "./plugin-dev-watch.js";

class FakeChildProcess extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	killed = false;

	kill(): boolean {
		this.killed = true;
		this.emit("exit", 0, null);
		return true;
	}
}

beforeEach(() => {
	stopAllPluginDevWatches();
	vi.clearAllMocks();
	mocks.setLink.mockReturnValue({
		id: "demo",
		devWatch: { projectDir: "C:/plugin", status: "starting" },
	});
	mocks.setServer.mockReturnValue({
		id: "demo",
		devWatch: { projectDir: "C:/plugin", status: "running" },
	});
});

describe("plugin development watch lifecycle", () => {
	it("resolves only after the compatible development server reports ready", async () => {
		const child = new FakeChildProcess();
		mocks.spawn.mockReturnValue(child);

		const started = startPluginDevWatch("demo", "C:/plugin");
		let settled = false;
		void started.finally(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		child.stdout.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({
					type: "ready",
					protocolVersion: 1,
					pluginId: "demo",
					entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
					origin: "http://127.0.0.1:4100",
				})}\n`,
			),
		);

		await expect(started).resolves.toMatchObject({ devWatch: { status: "running" } });
		expect(mocks.setServer).toHaveBeenCalledWith(
			"demo",
			"http://127.0.0.1:4100/mf-manifest.json",
			"http://127.0.0.1:4100",
		);
	});

	it("rejects when the development server exits before ready", async () => {
		const child = new FakeChildProcess();
		mocks.spawn.mockReturnValue(child);

		const started = startPluginDevWatch("demo", "C:/plugin");
		child.emit("exit", 1, null);

		await expect(started).rejects.toThrow("plugin dev server exited");
		expect(mocks.setServer).not.toHaveBeenCalled();
		expect(mocks.setStatus).toHaveBeenCalledWith("demo", "error", expect.stringContaining("exited"));
	});

	it("falls back to the stable plugin and schedules a restart when a running server exits", async () => {
		vi.useFakeTimers();
		try {
			const child = new FakeChildProcess();
			const restartedChild = new FakeChildProcess();
			mocks.spawn.mockReturnValueOnce(child).mockReturnValueOnce(restartedChild);

			const started = startPluginDevWatch("demo", "C:/plugin");
			child.stdout.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({
						type: "ready",
						protocolVersion: 1,
						pluginId: "demo",
						entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
						origin: "http://127.0.0.1:4100",
					})}\n`,
				),
			);
			await started;

			child.emit("exit", 1, null);
			expect(mocks.deactivateLink).toHaveBeenCalledWith("demo", expect.stringContaining("exited"));
			expect(mocks.spawn).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(250);
			expect(mocks.spawn).toHaveBeenCalledTimes(2);
		} finally {
			stopAllPluginDevWatches();
			vi.useRealTimers();
		}
	});

	it("rejects and stops an incompatible project development server", async () => {
		const child = new FakeChildProcess();
		mocks.spawn.mockReturnValue(child);

		const started = startPluginDevWatch("demo", "C:/plugin");
		child.stdout.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({
					type: "ready",
					protocolVersion: 0,
					pluginId: "demo",
					entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
					origin: "http://127.0.0.1:4100",
				})}\n`,
			),
		);

		await expect(started).rejects.toThrow("Incompatible plugin-vite development protocol");
		expect(child.killed).toBe(true);
	});
});
