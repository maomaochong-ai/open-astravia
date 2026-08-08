import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "./project";

const mocks = vi.hoisted(() => ({
	installFromPath: vi.fn(),
	setEnabled: vi.fn(),
	grantPermissions: vi.fn(),
	reload: vi.fn(),
	startDevWatch: vi.fn(),
	stat: vi.fn(),
}));

vi.mock("./runtime", () => ({
	getWorkbenchCommand: () => ({ run: vi.fn() }),
	getWorkbenchPlugins: () => ({
		installFromPath: mocks.installFromPath,
		setEnabled: mocks.setEnabled,
		grantPermissions: mocks.grantPermissions,
		reload: mocks.reload,
		startDevWatch: mocks.startDevWatch,
	}),
	withWorkbenchFs: (callback: (fs: { stat: typeof mocks.stat }) => unknown) => callback({ stat: mocks.stat }),
}));

import { applyPluginToVetta } from "./reinstall";

const project: ProjectInfo = {
	dir: "C:/plugins/demo",
	id: "demo",
	name: "Demo",
	version: "0.1.0",
	guidingWords: [],
	permissions: [],
	zipPath: "C:/plugins/demo/release/demo-0.1.0.zip",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.stat.mockResolvedValue({ isFile: true });
	mocks.reload.mockResolvedValue(undefined);
});

describe("applyPluginToVetta", () => {
	it("reports a development server startup failure after applying the plugin", async () => {
		mocks.startDevWatch.mockRejectedValue(new Error("plugin dev server unavailable"));

		await expect(
			applyPluginToVetta({ project, workbenchRoot: "C:/workbench", startHotReload: true }),
		).rejects.toThrow("plugin dev server unavailable");
	});
});
