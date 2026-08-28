import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Desktop development process build inputs", () => {
	it("invalidates the Main bundle when bundled platform runtime outputs change", () => {
		const source = readFileSync(new URL("./build-dev-processes.mjs", import.meta.url), "utf8");

		expect(source).toContain('join(repoRoot, "packages", "runtime-desktop", "package.json")');
		expect(source).toContain('join(repoRoot, "packages", "runtime-desktop", "dist")');
		expect(source).toContain('join(repoRoot, "packages", "runtime-node", "package.json")');
		expect(source).toContain('join(repoRoot, "packages", "runtime-node", "dist")');
	});
});
