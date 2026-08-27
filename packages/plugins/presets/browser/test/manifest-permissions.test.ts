import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Browser preset manifest", () => {
	it("uses host browser capabilities and no longer requests command or storage escape hatches", async () => {
		const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../plugin.json"), "utf8")) as {
			permissions: string[];
			commands?: string[];
			browser?: { allowedHosts: string[] };
		};
		expect(manifest.permissions).toEqual(
			expect.arrayContaining([
				"browser.read",
				"browser.interact",
				"browser.profile.persist",
				"agent.tools.register",
				"agent.toolHandler.execute",
			]),
		);
		expect(manifest.permissions).not.toEqual(
			expect.arrayContaining(["agent.command.run", "agent.command.spawn", "storage.read", "storage.write"]),
		);
		expect(manifest.commands).toBeUndefined();
		expect(manifest.browser?.allowedHosts).toEqual(["*"]);
	});
});
