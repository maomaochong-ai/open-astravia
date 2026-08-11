import { describe, expect, it } from "vitest";
import * as coding from "../src/coding/index.js";
import * as root from "../src/index.js";

describe("runtime-tools root entry", () => {
	it("publishes the native coding tool surface", () => {
		expect(root.createCodingToolsFeature).toBe(coding.createCodingToolsFeature);
		expect(root.createReadTool).toBe(coding.createReadTool);
		expect(root.InMemoryCodingToolRegistry).toBe(coding.InMemoryCodingToolRegistry);
	});

	it("does not publish retired coding-agent singleton collections", () => {
		expect("codingTools" in root).toBe(false);
		expect("readOnlyTools" in root).toBe(false);
		expect("readTool" in root).toBe(false);
	});
});
