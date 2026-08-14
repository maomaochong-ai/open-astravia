import { describe, expect, it } from "vitest";
import * as coding from "../src/coding/index.js";
import * as root from "../src/index.js";

describe("runtime-tools root entry", () => {
	it("publishes only the platform-neutral coding tool protocol", () => {
		expect(root.createCodingToolsFeature).toBe(coding.createCodingToolsFeature);
		expect(root.InMemoryCodingToolRegistry).toBe(coding.InMemoryCodingToolRegistry);
		expect("createReadTool" in root).toBe(false);
		expect("createShellTool" in root).toBe(false);
	});

	it("does not publish retired coding-agent singleton collections", () => {
		expect("codingTools" in root).toBe(false);
		expect("readOnlyTools" in root).toBe(false);
		expect("readTool" in root).toBe(false);
	});
});
