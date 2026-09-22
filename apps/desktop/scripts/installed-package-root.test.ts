import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInstalledPackageRoot } from "./installed-package-root.mjs";

describe("installed package root resolution", () => {
	let fixtureRoot: string;

	beforeEach(() => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "vetta-installed-package-"));
	});

	afterEach(() => {
		rmSync(fixtureRoot, { recursive: true, force: true });
	});

	it("resolves a binary-only package without a JavaScript entry", () => {
		const packageRoot = join(fixtureRoot, "node_modules", "@native", "binary-only");
		mkdirSync(packageRoot, { recursive: true });
		writeFileSync(
			join(packageRoot, "package.json"),
			JSON.stringify({ name: "@native/binary-only", version: "1.0.0" }),
		);
		writeFileSync(join(packageRoot, "binding.node"), "");

		expect(resolveInstalledPackageRoot("@native/binary-only", fixtureRoot)).toBe(packageRoot);
	});
});
