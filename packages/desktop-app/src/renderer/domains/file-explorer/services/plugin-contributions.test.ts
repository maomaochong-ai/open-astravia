import type {
	RegisteredFileExplorerContextMenuAction,
	RegisteredFileExplorerDecorationProvider,
} from "@shared/store/atoms";
import { describe, expect, it, vi } from "vitest";
import {
	matchesFileExplorerWhen,
	resolveFileExplorerDecoration,
	sortFileExplorerActions,
} from "./plugin-contributions";

const file = {
	name: "Index.TSX",
	path: "C:\\workspace\\src\\Index.TSX",
	isDirectory: false,
	size: 10,
	modifiedAt: 1,
};

describe("file explorer plugin contributions", () => {
	it("matches resource type, extensions and exact names case-insensitively", () => {
		expect(matchesFileExplorerWhen(file, { resourceType: "file", extensions: [".tsx"] })).toBe(true);
		expect(matchesFileExplorerWhen(file, { fileNames: ["index.tsx"] })).toBe(true);
		expect(matchesFileExplorerWhen(file, { resourceType: "directory" })).toBe(false);
		expect(matchesFileExplorerWhen(file, { extensions: ["ts"] })).toBe(false);
	});

	it("sorts actions by ascending order without mutating the registry", () => {
		const run = vi.fn();
		const actions: RegisteredFileExplorerContextMenuAction[] = [
			{ pluginId: "a", actionId: "a:late", id: "a:late", label: "Late", order: 200, run },
			{ pluginId: "a", actionId: "a:early", id: "a:early", label: "Early", order: 10, run },
		];
		expect(sortFileExplorerActions(actions).map((action) => action.actionId)).toEqual(["a:early", "a:late"]);
		expect(actions[0]?.actionId).toBe("a:late");
	});

	it("uses the highest-priority matching decoration and falls back after provider errors", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const providers: RegisteredFileExplorerDecorationProvider[] = [
			{
				pluginId: "broken",
				providerId: "broken:status",
				id: "broken:status",
				priority: 100,
				provideDecoration: () => {
					throw new Error("broken");
				},
			},
			{
				pluginId: "working",
				providerId: "working:status",
				id: "working:status",
				priority: 10,
				when: { extensions: ["tsx"] },
				provideDecoration: () => ({ badge: "M", tooltip: "Modified" }),
			},
		];

		expect(resolveFileExplorerDecoration(file, providers)).toEqual({
			pluginId: "working",
			decoration: { badge: "M", tooltip: "Modified" },
		});
		expect(error).toHaveBeenCalledOnce();
		error.mockRestore();
	});
});
