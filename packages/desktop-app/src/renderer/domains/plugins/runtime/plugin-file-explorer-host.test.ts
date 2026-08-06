import { describe, expect, it, vi } from "vitest";
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
		const selectionHandle = onPluginFileExplorerSelectionChanged(selectionListener);
		const fileHandle = onPluginFileExplorerFilesChanged(fileListener);

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
});
