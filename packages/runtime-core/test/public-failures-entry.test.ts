import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRuntimeFailure } from "../src/failures.js";

describe("public failures entry", () => {
	it("exposes the structured reader without loading provider implementations", () => {
		const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			exports?: Record<string, { import?: string; types?: string }>;
		};
		const portableSources = ["../src/failures.ts", "../src/failure-contract.ts"].map((path) =>
			readFileSync(new URL(path, import.meta.url), "utf8"),
		);

		expect(packageManifest.exports?.["./failures"]).toEqual({
			types: "./dist/failures.d.ts",
			import: "./dist/failures.js",
		});
		expect(portableSources.join("\n")).not.toContain("@vetta/ai");
		expect(
			readRuntimeFailure({
				code: "MCP_RELOAD_FAILED",
				message: "reload failed",
				retryable: false,
				origin: "extension",
			}),
		).toMatchObject({ code: "MCP_RELOAD_FAILED", origin: "extension" });
	});
});
