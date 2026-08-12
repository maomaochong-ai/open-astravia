import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest.js";

const baseManifest = {
	id: "agent-mode-test",
	name: "Agent mode test",
	version: "1.0.0",
	pluginApiVersion: "^1.0.0",
	entry: "dist/index.js",
};

// agent_mode 只是偏好声明（宿主不再据此排除插件），解析结果仍须稳定。
describe("plugin manifest agent_mode", () => {
	it("keeps the field absent when it is not declared", () => {
		expect(parsePluginManifest(baseManifest).agent_mode).toBeUndefined();
	});

	it("normalizes a single string and an array declaration", () => {
		expect(parsePluginManifest({ ...baseManifest, agent_mode: "coding" }).agent_mode).toEqual(["coding"]);
		expect(parsePluginManifest({ ...baseManifest, agent_mode: ["work", "coding"] }).agent_mode).toEqual([
			"work",
			"coding",
		]);
	});

	it("treats an empty array as undeclared", () => {
		expect(parsePluginManifest({ ...baseManifest, agent_mode: [] }).agent_mode).toBeUndefined();
	});

	it("rejects non-string and blank declarations", () => {
		expect(() => parsePluginManifest({ ...baseManifest, agent_mode: 1 })).toThrow();
		expect(() => parsePluginManifest({ ...baseManifest, agent_mode: ["  "] })).toThrow();
	});
});
