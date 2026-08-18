import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: {} }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../app-monitor/app-monitor-service.js", () => ({
	getAppMonitorSnapshot: vi.fn(),
	recordAppMonitorEvent: vi.fn(),
	recordAppMonitorUserActivity: vi.fn(),
}));
vi.mock("../telemetry/index.js", () => ({ captureProductEvent: vi.fn() }));

import { parseAppMonitorEvent } from "./app-monitor";

describe("parseAppMonitorEvent", () => {
	it("accepts a valid settings event and normalizes optional values", () => {
		expect(
			parseAppMonitorEvent({
				type: "settings.changed",
				tab: "models",
				action: "changed",
				target: "provider",
				value: "openai",
			}),
		).toEqual({
			type: "settings.changed",
			tab: "models",
			action: "changed",
			target: "provider",
			value: "openai",
		});
	});

	it("rejects unknown, incomplete, and malformed payloads", () => {
		expect(parseAppMonitorEvent(null)).toBeNull();
		expect(parseAppMonitorEvent({ type: "unknown" })).toBeNull();
		expect(parseAppMonitorEvent({ type: "settings.changed", tab: "models", action: "changed" })).toBeNull();
		expect(
			parseAppMonitorEvent({ type: "input.attachments.added", source: "drop", files: [], images: [] }),
		).toBeNull();
	});

	it("filters invalid attachment entries while preserving valid entries", () => {
		expect(
			parseAppMonitorEvent({
				type: "input.attachments.added",
				source: "paste",
				files: [{ extension: ".md", isDirectory: false, sizeBytes: 12 }, { name: 1 }],
				images: [{ format: "png", width: 100, height: 50 }, null],
			}),
		).toEqual({
			type: "input.attachments.added",
			source: "paste",
			files: [{ extension: ".md", isDirectory: false, sizeBytes: 12 }],
			images: [{ format: "png", width: 100, height: 50 }],
		});
	});
});
