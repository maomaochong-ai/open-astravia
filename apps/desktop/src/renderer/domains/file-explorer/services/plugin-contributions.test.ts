import type {
	RegisteredFileExplorerContextMenuAction,
	RegisteredFileExplorerDecorationProvider,
} from "@shared/store/atoms";
import { describe, expect, it, vi } from "vitest";
import {
	createFileExplorerDecorations,
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
	it("propagates announced descendants without opening folders and honors direct status and workspace boundaries", () => {
		const child = { ...file, path: "/project/src/deep/a.ts", name: "a.ts" };
		const folder = { ...file, path: "/project/src", name: "src", isDirectory: true };
		let changed = true;
		const providers: RegisteredFileExplorerDecorationProvider[] = [
			{
				pluginId: "status",
				providerId: "status:git",
				id: "status:git",
				changedEntries: new Map([[child.path, child]]),
				provideDecoration: (entry) =>
					changed && entry.path === child.path ? { badge: "M", color: "warning", propagate: true } : null,
			},
		];
		const cache = new Map([["/project", [folder]]]);
		expect(createFileExplorerDecorations("/project", cache, providers).get(folder.path)?.decoration).toMatchObject({
			badge: "M",
			color: "warning",
		});
		expect(createFileExplorerDecorations("/other", new Map(), providers).size).toBe(0);
		changed = false;
		expect(createFileExplorerDecorations("/project", cache, providers).size).toBe(0);
	});
	it("matches resource type, extensions and exact names case-insensitively", () => {
		expect(matchesFileExplorerWhen(file, { resourceType: "file", extensions: [".tsx"] })).toBe(true);
		expect(matchesFileExplorerWhen(file, { fileNames: ["index.tsx"] })).toBe(true);
		expect(matchesFileExplorerWhen(file, { resourceType: "directory" })).toBe(false);
		expect(matchesFileExplorerWhen(file, { extensions: ["ts"] })).toBe(false);
	});

	it("matches extensions on directories too, so bundle dirs can be decorated", () => {
		const bundle = { name: "login-app.vetd", path: "/w/login-app.vetd", isDirectory: true, size: 0, modifiedAt: 1 };
		expect(matchesFileExplorerWhen(bundle, { resourceType: "directory", extensions: ["vetd"] })).toBe(true);
		expect(matchesFileExplorerWhen(bundle, { extensions: ["vetd"] })).toBe(true);
		expect(matchesFileExplorerWhen(bundle, { extensions: ["vetdz"] })).toBe(false);
		// 显式要文件的匹配器不受影响。
		expect(matchesFileExplorerWhen(bundle, { resourceType: "file", extensions: ["vetd"] })).toBe(false);
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
			priority: 10,
			decoration: { badge: "M", tooltip: "Modified" },
		});
		expect(error).toHaveBeenCalledOnce();
		error.mockRestore();
	});
});
