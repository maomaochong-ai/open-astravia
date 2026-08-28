import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Browser preset manifest", () => {
	it("only uses the host API for runtime management and contributes no Agent Tool", async () => {
		const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../plugin.json"), "utf8")) as {
			permissions: string[];
			commands?: string[];
			browser?: { allowedHosts: string[] };
		};
		expect(manifest.permissions).toEqual(
			expect.arrayContaining(["agent.skills.control", "browser.read", "browser.runtime.manage"]),
		);
		expect(manifest.permissions).not.toEqual(
			expect.arrayContaining([
				"agent.tools.register",
				"agent.toolHandler.execute",
				"browser.interact",
				"browser.profile.persist",
				"browser.attach",
			]),
		);
		expect(manifest.commands).toBeUndefined();
		expect(manifest.browser?.allowedHosts).toEqual(["*"]);
	});
});
