import { describe, expect, it } from "vitest";
import {
	normalizePluginDevServerUrls,
	parsePluginDevServerEvent,
	parsePluginDevServerOutput,
} from "./plugin-dev-protocol.js";

describe("plugin dev server protocol", () => {
	it("parses supported NDJSON events and rejects malformed payloads", () => {
		expect(
			parsePluginDevServerEvent(
				JSON.stringify({
					type: "ready",
					pluginId: "demo",
					entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
					origin: "http://127.0.0.1:4100",
				}),
			),
		).toEqual({
			type: "ready",
			pluginId: "demo",
			entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
			origin: "http://127.0.0.1:4100",
		});
		expect(parsePluginDevServerEvent(JSON.stringify({ type: "update", pluginId: "demo" }))).toEqual({
			type: "update",
			pluginId: "demo",
		});
		expect(parsePluginDevServerEvent(JSON.stringify({ type: "error", message: "compile failed" }))).toEqual({
			type: "error",
			message: "compile failed",
		});
		expect(parsePluginDevServerEvent("not-json")).toBeUndefined();
		expect(parsePluginDevServerEvent(JSON.stringify({ type: "ready", pluginId: "demo" }))).toBeUndefined();
	});

	it("preserves split lines across stdout chunks and ignores unrelated output", () => {
		const first = parsePluginDevServerOutput("", '{"type":"update","pluginId":"de');
		expect(first.events).toEqual([]);
		const second = parsePluginDevServerOutput(
			first.remainder,
			'mo"}\nVite diagnostic\n{"type":"error","pluginId":"demo","message":"failed"}\n',
		);
		expect(second.remainder).toBe("");
		expect(second.events).toEqual([
			{ type: "update", pluginId: "demo" },
			{ type: "error", pluginId: "demo", message: "failed" },
		]);
	});

	it("accepts only same-origin local HTTP development endpoints", () => {
		expect(normalizePluginDevServerUrls("http://127.0.0.1:4100/mf-manifest.json", "http://127.0.0.1:4100/")).toEqual({
			entryUrl: "http://127.0.0.1:4100/mf-manifest.json",
			origin: "http://127.0.0.1:4100",
		});
		expect(() => normalizePluginDevServerUrls("https://example.com/mf-manifest.json", "https://example.com")).toThrow(
			"local HTTP origin",
		);
		expect(() =>
			normalizePluginDevServerUrls("http://127.0.0.1:4101/mf-manifest.json", "http://127.0.0.1:4100"),
		).toThrow("local HTTP origin");
	});
});
