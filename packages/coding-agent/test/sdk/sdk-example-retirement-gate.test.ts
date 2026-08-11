import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EXAMPLES_DIRECTORY = new URL("../../examples/sdk/", import.meta.url);
const BARE_PACKAGE_IMPORT = /from\s+["']@vetta\/coding-agent["']/;

describe("SDK example retirement gate", () => {
	it("keeps all SDK examples on stable public subpaths", () => {
		const consumers = readdirSync(EXAMPLES_DIRECTORY)
			.filter((name) => name.endsWith(".ts"))
			.filter((name) => BARE_PACKAGE_IMPORT.test(readFileSync(new URL(name, EXAMPLES_DIRECTORY), "utf8")))
			.sort();

		expect(consumers).toEqual([]);
	});
});
