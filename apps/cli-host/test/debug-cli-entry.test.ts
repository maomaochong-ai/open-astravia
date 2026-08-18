import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lightweight Debug CLI entry", () => {
	it("prints Debug help without loading the Agent CLI composition", () => {
		const entryPath = resolve(import.meta.dirname, "../src/debug-cli.ts");
		const result = spawnSync("bun", [entryPath, "debug", "--help"], {
			cwd: resolve(import.meta.dirname, "../../.."),
			encoding: "utf8",
			timeout: 10_000,
			windowsHide: true,
		});

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("Vetta Debug command line interface");
		expect(result.stderr).toBe("");
	});
});
