import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
	const images = new Map<string, { empty: boolean; width: number; height: number }>();

	function makeImage(key: string, empty = false, width = 64, height = 64) {
		images.set(key, { empty, width, height });
		const image = {
			isEmpty: () => images.get(key)?.empty ?? true,
			getSize: () => {
				const meta = images.get(key) ?? { empty: true, width: 0, height: 0 };
				return { width: meta.width, height: meta.height };
			},
			resize: ({ width, height }: { width: number; height: number }) => {
				const resizedKey = `${key}@${width}x${height}`;
				images.set(resizedKey, { empty: false, width, height });
				return makeImage(resizedKey, false, width, height);
			},
		};
		return image;
	}

	return {
		images,
		makeImage,
		createFromPath: vi.fn((path: string) => {
			if (path.includes("missing")) return makeImage(`path:${path}`, true);
			return makeImage(`path:${path}`, false, 256, 256);
		}),
		createFromDataURL: vi.fn((dataUrl: string) => {
			if (!dataUrl.startsWith("data:image/png")) return makeImage(`data:bad`, true);
			return makeImage(`data:${dataUrl.slice(0, 40)}`, false, 32, 32);
		}),
	};
});

vi.mock("electron", () => ({
	nativeImage: {
		createFromPath: electronMock.createFromPath,
		createFromDataURL: electronMock.createFromDataURL,
	},
}));

vi.mock("../window-manager.js", () => ({
	iconPath: {
		linux: "/app/build/icon.png",
		win32: "/app/build/icon.ico",
		darwin: "/app/build/icon.icns",
	},
}));

/** Minimal valid-looking PNG data URL prefix for validation. */
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("native-drag-icon", () => {
	beforeEach(async () => {
		vi.resetModules();
		electronMock.createFromPath.mockClear();
		electronMock.createFromDataURL.mockClear();
		electronMock.images.clear();
		const mod = await import("./native-drag-icon.js");
		mod.clearNativeDragIconCacheForTests();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("falls back to the app PNG when no type icon is cached", async () => {
		const { resolveNativeDragIcon } = await import("./native-drag-icon.js");
		const icon = resolveNativeDragIcon(["C:\\project\\report.ts"]);
		expect(icon.isEmpty()).toBe(false);
		expect(electronMock.createFromPath).toHaveBeenCalled();
		expect(electronMock.createFromDataURL).not.toHaveBeenCalled();
	});

	it("uses a renderer-cached PNG type icon when available", async () => {
		const { cacheNativeDragIconFromDataUrl, resolveNativeDragIcon } = await import("./native-drag-icon.js");
		expect(cacheNativeDragIconFromDataUrl("C:\\project\\report.ts", PNG_DATA_URL)).toBe(true);

		electronMock.createFromPath.mockClear();
		const icon = resolveNativeDragIcon(["C:\\project\\report.ts"]);
		expect(icon.isEmpty()).toBe(false);
		expect(electronMock.createFromDataURL).toHaveBeenCalledWith(PNG_DATA_URL);
		expect(electronMock.createFromPath).not.toHaveBeenCalled();
	});

	it("rejects non-png data URLs", async () => {
		const { cacheNativeDragIconFromDataUrl } = await import("./native-drag-icon.js");
		expect(cacheNativeDragIconFromDataUrl("C:\\a.ts", "data:image/svg+xml,<svg/>")).toBe(false);
		expect(cacheNativeDragIconFromDataUrl("C:\\a.ts", "not-a-data-url")).toBe(false);
	});

	it("createFallbackAppDragIcon prefers the PNG candidate", async () => {
		const { createFallbackAppDragIcon } = await import("./native-drag-icon.js");
		const icon = createFallbackAppDragIcon();
		expect(icon.isEmpty()).toBe(false);
		expect(electronMock.createFromPath.mock.calls[0]?.[0]).toBe("/app/build/icon.png");
	});
});
