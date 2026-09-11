import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
	readonly id: string;
	readonly permissions?: string[];
	readonly agent?: {
		readonly agents?: { id: string; name: string; description?: string; systemPromptPath?: string }[];
	};
}

async function readManifest(): Promise<Manifest> {
	return JSON.parse(await readFile(resolve(import.meta.dirname, "../plugin.json"), "utf8")) as Manifest;
}

async function readLocale(locale: string): Promise<Record<string, string>> {
	return JSON.parse(await readFile(resolve(import.meta.dirname, `../locales/${locale}.json`), "utf8")) as Record<
		string,
		string
	>;
}

describe("Preset agent manifest", () => {
	it("contributes exactly the three host personas and asks for no permission", async () => {
		const manifest = await readManifest();
		expect(manifest.id).toBe("preset-agent");
		expect(manifest.agent?.agents?.map((agent) => agent.id)).toEqual(["master", "developer", "researcher"]);
		// 纯人设插件：拿到任何权限都说明有别的东西混了进来。
		expect(manifest.permissions).toBeUndefined();
	});

	it("ships a readable prompt for every agent", async () => {
		const manifest = await readManifest();
		for (const agent of manifest.agent?.agents ?? []) {
			expect(agent.systemPromptPath).toBeDefined();
			const prompt = await readFile(resolve(import.meta.dirname, "..", agent.systemPromptPath!), "utf8");
			expect(prompt.trim().length).toBeGreaterThan(0);
		}
	});

	it("resolves every %key% placeholder in both locales", async () => {
		const manifest = await readManifest();
		const placeholders = (manifest.agent?.agents ?? []).flatMap((agent) => [agent.name, agent.description ?? ""]);
		for (const locale of ["zh", "en"]) {
			const messages = await readLocale(locale);
			for (const raw of placeholders) {
				const key = /^%([^%]+)%$/.exec(raw)?.[1];
				expect(key, `${raw} must be a locale placeholder`).toBeDefined();
				expect(messages[key!], `${key} missing in ${locale}`).toBeTruthy();
			}
		}
	});
});
