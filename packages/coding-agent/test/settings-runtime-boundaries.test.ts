import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import { SettingsRuntime } from "../src/settings/index.js";

describe("SettingsRuntime boundaries", () => {
	const root = join(process.cwd(), "test-settings-runtime-boundaries");
	const agentDir = join(root, "agent");
	const projectDir = join(root, "project");
	const globalPath = join(agentDir, "settings.json");

	beforeEach(() => {
		rmSync(root, { recursive: true, force: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("migrates legacy queue, transport and skill settings before validation", () => {
		writeFileSync(
			globalPath,
			JSON.stringify({
				queueMode: "all",
				websockets: true,
				skills: { enableSkillCommands: false, customDirectories: ["legacy-skills"] },
			}),
		);

		const settings = SettingsRuntime.create(projectDir, agentDir);

		expect(settings.getSteeringMode()).toBe("all");
		expect(settings.getTransport()).toBe("websocket");
		expect(settings.getSkillPaths()).toEqual(["legacy-skills"]);
		expect(settings.getEnableSkillCommands()).toBe(false);
	});

	it("reports an invalid known field without exposing an untyped value", () => {
		writeFileSync(globalPath, JSON.stringify({ images: { blockImages: "yes" } }));

		const settings = SettingsRuntime.create(projectDir, agentDir);

		expect(settings.getBlockImages()).toBe(false);
		const [error] = settings.drainErrors();
		expect(error?.scope).toBe("global");
		expect(error?.error.message).toContain("Invalid settings document");
	});

	it("preserves unknown top-level fields while persisting a known field", async () => {
		writeFileSync(globalPath, JSON.stringify({ pluginOwned: { enabled: true }, theme: "dark" }));
		const settings = SettingsRuntime.create(projectDir, agentDir);

		settings.setTheme("light");
		await settings.flush();

		const persisted = JSON.parse(readFileSync(globalPath, "utf8")) as Record<string, unknown>;
		expect(persisted.pluginOwned).toEqual({ enabled: true });
		expect(persisted.theme).toBe("light");
	});

	it("preserves an externally changed sibling in a nested settings block", async () => {
		writeFileSync(globalPath, JSON.stringify({ images: { autoResize: true, maxRecentImages: 2 } }));
		const settings = SettingsRuntime.create(projectDir, agentDir);
		writeFileSync(globalPath, JSON.stringify({ images: { autoResize: false, maxRecentImages: 7 } }));

		settings.setBlockImages(true);
		await settings.flush();

		const persisted = JSON.parse(readFileSync(globalPath, "utf8")) as {
			images: { autoResize: boolean; blockImages: boolean; maxRecentImages: number };
		};
		expect(persisted.images).toEqual({ autoResize: false, blockImages: true, maxRecentImages: 7 });
	});
});
