import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	watcher: {
		on: vi.fn(),
		add: vi.fn(),
		unwatch: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	},
	server: {
		config: { plugins: [{ name: "vetta-plugin-dev-runtime" }] },
		resolvedUrls: { local: ["http://127.0.0.1:4100/"] },
		listen: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	},
}));

vi.mock("chokidar", () => ({ watch: () => mocks.watcher }));
vi.mock("vite", () => ({ createServer: async () => mocks.server }));

import { startVettaPluginDevServer } from "../src/dev-server.js";

const projectDir = join(process.cwd(), `.tmp-plugin-dev-watcher-${process.pid}`);

afterEach(async () => {
	vi.unstubAllGlobals();
	await rm(projectDir, { recursive: true, force: true });
});

describe("plugin development resource watcher", () => {
	it("does not block server readiness on the watcher's initial scan", async () => {
		await mkdir(projectDir, { recursive: true });
		await writeFile(
			join(projectDir, "plugin.json"),
			JSON.stringify({
				id: "watcher-test",
				name: "Watcher test",
				version: "0.1.0",
				pluginApiVersion: "^1.0.0",
				runtime: "module-federation",
				entry: "dist/mf-manifest.json",
				moduleFederation: { remoteName: "watcher_test", expose: "./plugin" },
				permissions: [],
			}),
		);
		vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

		const events: unknown[] = [];
		const server = await startVettaPluginDevServer(projectDir, (event) => events.push(event));

		expect(server.origin).toBe("http://127.0.0.1:4100");
		expect(events).toContainEqual({
			type: "ready",
			protocolVersion: 1,
			pluginId: "watcher-test",
			entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
			origin: "http://127.0.0.1:4100",
		});
		await server.close();
	});
});
