// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import type { PluginFileExplorerEntry } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createPluginFileExplorerApi } from "./plugin-file-explorer-context";
import { validateFileExplorerDecoration } from "./plugin-file-explorer-validation";
import { PluginLocalContributions } from "./plugin-local-contributions";

function setup(granted = true) {
	const contributions = new PluginLocalContributions();
	const disposers: Array<() => void> = [];
	const onChanged = vi.fn();
	const permissions = granted ? ["ui.file-explorer.decorations"] : [];
	const plugin = { id: "example", permissions, grantedPermissions: permissions } as unknown as InstalledPlugin;
	return {
		contributions,
		disposers,
		onChanged,
		api: createPluginFileExplorerApi({ plugin, contributions, disposers, onChanged }),
	};
}

describe("file explorer plugin registration contract", () => {
	it("gates theme and decoration registration without granting filesystem access", () => {
		const { api, contributions } = setup(false);
		expect(() => api.registerIconTheme({ id: "icons", label: "Icons", iconDefinitions: {} })).toThrow("permission");
		expect(() => api.registerDecorationProvider({ id: "status", provideDecoration: () => null })).toThrow(
			"permission",
		);
		expect(contributions.fileIconThemes).toEqual([]);
	});
	it("validates associations before publication, namespaces ids and disposes registrations", () => {
		const { api, contributions, disposers } = setup();
		expect(() => api.registerIconTheme({ id: "bad", label: "Bad", iconDefinitions: {}, file: "missing" })).toThrow(
			"Unknown",
		);
		const registration = api.registerIconTheme({
			id: "icons",
			label: "Icons",
			iconDefinitions: { ts: "T" },
			fileExtensions: { TS: "ts" },
		});
		expect(contributions.fileIconThemes[0]).toMatchObject({ id: "example:icons", fileExtensions: { ts: "ts" } });
		expect(() => api.registerIconTheme({ id: "icons", label: "Duplicate", iconDefinitions: {} })).toThrow(
			"Duplicate",
		);
		registration.dispose();
		for (const dispose of disposers) dispose();
		expect(contributions.fileIconThemes).toEqual([]);
	});
	it("invalidates decorations without filesystem refresh and ignores events after unload", () => {
		const { api, contributions, disposers, onChanged } = setup();
		let emit: (entries?: readonly PluginFileExplorerEntry[]) => void = () => {};
		const unsubscribe = vi.fn();
		const registration = api.registerDecorationProvider({
			id: "status",
			provideDecoration: () => ({ badge: "M", color: "warning" }),
			onDidChangeDecorations(listener) {
				emit = listener;
				return { dispose: unsubscribe };
			},
		});
		const entry = { name: "a.ts", path: "/project/src/a.ts", isDirectory: false, size: 1, modifiedAt: 0 };
		emit([entry]);
		expect(contributions.fileExplorerDecorationProviders[0]?.changedEntries.get(entry.path)).toEqual(entry);
		emit();
		expect(contributions.fileExplorerDecorationProviders[0]?.changedEntries.size).toBe(0);
		registration.dispose();
		for (const dispose of disposers) dispose();
		onChanged.mockClear();
		emit([entry]);
		expect(contributions.fileExplorerDecorationProviders).toEqual([]);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(onChanged).not.toHaveBeenCalled();
	});
	it("keeps legacy decorations and rejects unsafe or malformed values", () => {
		expect(validateFileExplorerDecoration({ badge: "M", tooltip: "Modified" })).toMatchObject({
			badge: "M",
			tooltip: "Modified",
		});
		expect(() => validateFileExplorerDecoration({ color: "url(https://example.com)" })).toThrow();
		expect(() => validateFileExplorerDecoration({ badge: {} })).toThrow();
		expect(() =>
			setup().api.registerDecorationProvider({ id: "status", priority: Number.NaN, provideDecoration: () => null }),
		).toThrow();
		expect(() =>
			setup().api.registerDecorationProvider({
				id: "status",
				provideDecoration: () => null,
				onDidChangeDecorations: (() => undefined) as never,
			}),
		).toThrow("disposable");
	});
});
