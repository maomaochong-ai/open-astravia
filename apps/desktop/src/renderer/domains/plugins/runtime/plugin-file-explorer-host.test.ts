import { describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("./plugin-runtime-log", () => ({ logPluginRuntimeError: logError }));

import {
	bindPluginFileExplorerHost,
	emitPluginFileExplorerFilesChanged,
	emitPluginFileExplorerSelectionChanged,
	getPluginFileExplorerSelection,
	getPluginFileExplorerWorkspaceRoots,
	onPluginFileExplorerFilesChanged,
	onPluginFileExplorerSelectionChanged,
	refreshPluginFileExplorer,
	revealPluginFileExplorerPath,
} from "./plugin-file-explorer-host";

const entry = {
	name: "index.ts",
	path: "/workspace/index.ts",
	isDirectory: false,
	size: 5,
	modifiedAt: 1,
};

describe("plugin file explorer host", () => {
	it("exposes the active host adapter and clears it on dispose", async () => {
		const reveal = vi.fn(async () => {});
		const refresh = vi.fn(async () => {});
		const handle = bindPluginFileExplorerHost({
			getWorkspaceRoot: () => ({ name: "workspace", path: "/workspace" }),
			getSelection: () => [entry],
			reveal,
			refresh,
		});

		expect(getPluginFileExplorerWorkspaceRoots()).toEqual([{ name: "workspace", path: "/workspace" }]);
		expect(getPluginFileExplorerSelection()).toEqual([entry]);
		await revealPluginFileExplorerPath(entry.path, { focus: true });
		await refreshPluginFileExplorer();
		expect(reveal).toHaveBeenCalledWith(entry.path, { focus: true });
		expect(refresh).toHaveBeenCalledWith(undefined);

		handle.dispose();
		expect(getPluginFileExplorerWorkspaceRoots()).toEqual([]);
		await expect(refreshPluginFileExplorer()).rejects.toThrow("File explorer is not available");
	});

	it("notifies selection and file listeners until their handles are disposed", () => {
		const selectionListener = vi.fn();
		const fileListener = vi.fn();
		const selectionHandle = onPluginFileExplorerSelectionChanged("example", "1.0.0", selectionListener);
		const fileHandle = onPluginFileExplorerFilesChanged("example", "1.0.0", fileListener);

		emitPluginFileExplorerSelectionChanged([entry]);
		emitPluginFileExplorerFilesChanged([{ type: "changed", path: "/workspace" }]);
		expect(selectionListener).toHaveBeenCalledWith([entry]);
		expect(fileListener).toHaveBeenCalledWith([{ type: "changed", path: "/workspace" }]);

		selectionHandle.dispose();
		fileHandle.dispose();
		emitPluginFileExplorerSelectionChanged([]);
		emitPluginFileExplorerFilesChanged([{ type: "deleted", path: entry.path }]);
		expect(selectionListener).toHaveBeenCalledOnce();
		expect(fileListener).toHaveBeenCalledOnce();
	});

	it("logs the owning plugin when a listener fails without blocking other plugins", () => {
		logError.mockClear();
		const failing = onPluginFileExplorerSelectionChanged("broken", "2.0.0", () => {
			throw new Error("listener failed");
		});
		const healthyListener = vi.fn();
		const healthy = onPluginFileExplorerSelectionChanged("healthy", "3.0.0", healthyListener);

		emitPluginFileExplorerSelectionChanged([entry]);

		expect(healthyListener).toHaveBeenCalledWith([entry]);
		expect(logError).toHaveBeenCalledWith(
			"file explorer listener failed",
			{
				pluginId: "broken",
				pluginVersion: "2.0.0",
				stage: "selection-change",
			},
			expect.any(Error),
		);

		failing.dispose();
		healthy.dispose();
	});
});
