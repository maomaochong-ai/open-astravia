// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import { filePreviewAtom, filePreviewContextReadonlyAtom } from "@shared/store/atoms";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

function installedPlugin(permissions: PluginPermission[]): InstalledPlugin {
	return {
		id: "demo-plugin",
		name: "Demo",
		permissions,
		grantedPermissions: permissions,
	} as unknown as InstalledPlugin;
}

function createUi(permissions: PluginPermission[]) {
	return createPluginUiApi({
		plugin: installedPlugin(permissions),
		contributions: new PluginLocalContributions(),
		onChanged: () => {},
		disposers: [],
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
}

describe("ui.previewFile", () => {
	beforeEach(() => {
		getDefaultStore().set(filePreviewAtom, null);
	});

	it("opens a local path in the global previewer and derives the name from the basename", () => {
		const ui = createUi(["fs.read"]);

		ui.previewFile({ path: "/work/out/report.pdf" });

		expect(getDefaultStore().get(filePreviewAtom)).toEqual({
			name: "report.pdf",
			path: "/work/out/report.pdf",
		});
	});

	it("keeps the declared name, mime and size", () => {
		const ui = createUi(["fs.read"]);

		ui.previewFile({ path: "/work/out/tmp-8f3.bin", name: "diagram.svg", mimeType: "image/svg+xml", size: 42 });

		expect(getDefaultStore().get(filePreviewAtom)).toEqual({
			name: "diagram.svg",
			path: "/work/out/tmp-8f3.bin",
			mime: "image/svg+xml",
			size: 42,
		});
	});

	it("opens a group starting at the given file, matched by source rather than object identity", () => {
		const ui = createUi(["fs.read"]);

		ui.previewFile({ path: "/work/out/b.png" }, [
			{ path: "/work/out/a.png" },
			{ path: "/work/out/b.png" },
			{ path: "/work/out/c.png" },
		]);

		const ctx = getDefaultStore().get(filePreviewContextReadonlyAtom);
		expect(ctx?.index).toBe(1);
		expect(ctx?.items.map((item) => item.name)).toEqual(["a.png", "b.png", "c.png"]);
	});

	it("gates local paths behind fs.read", () => {
		const ui = createUi(["ui.slot.message"]);

		expect(() => ui.previewFile({ path: "/work/out/report.pdf" })).toThrow();
		expect(getDefaultStore().get(filePreviewAtom)).toBeNull();
	});

	it("gates url-only sources behind ui.slot.message", () => {
		const granted = createUi(["ui.slot.message"]);
		granted.previewFile({ url: "https://host/media/a", name: "a.png" });
		expect(getDefaultStore().get(filePreviewAtom)).toEqual({ name: "a.png", url: "https://host/media/a" });

		const denied = createUi(["fs.read"]);
		expect(() => denied.previewFile({ url: "https://host/media/b", name: "b.png" })).toThrow();
	});

	it("rejects sourceless and relative-path references", () => {
		const ui = createUi(["fs.read", "ui.slot.message"]);

		expect(() => ui.previewFile({ name: "a.png" })).toThrow(/path or a url/);
		expect(() => ui.previewFile({ path: "out/a.png" })).toThrow(/absolute path/);
		expect(getDefaultStore().get(filePreviewAtom)).toBeNull();
	});
});
