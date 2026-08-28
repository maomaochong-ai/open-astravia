import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function activeIgnoreRules(contents: string): string[] {
	return contents
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("Vercel deployment contract", () => {
	it("keeps the public documentation content in the upload", () => {
		const rules = activeIgnoreRules(readFileSync(resolve(repoRoot, ".vercelignore"), "utf8"));

		expect(rules).toContain("/docs");
		expect(rules).not.toContain("docs");
	});

	it("does not require Git history after .git has been excluded", () => {
		const config = JSON.parse(readFileSync(resolve(appRoot, "vercel.json"), "utf8")) as {
			ignoreCommand?: string;
		};

		expect(config.ignoreCommand).toBeUndefined();
	});
});
