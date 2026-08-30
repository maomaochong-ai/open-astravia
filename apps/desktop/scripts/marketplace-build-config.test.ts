import type * as Vite from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mainConfig from "../vite.main.config";

vi.mock("vite", async (importOriginal) => ({
	...(await importOriginal<typeof Vite>()),
	loadEnv: () => ({}),
}));

beforeEach(() => {
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("VETTA_")) vi.stubEnv(key, undefined);
	}
	vi.stubEnv("VETTA_SERVER_URL", "https://server.example/api/v1");
	vi.stubEnv("VETTA_SPEECH_INPUT_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("independent marketplace build configuration", () => {
	it.each([
		{ mode: "development", cloud: "true" },
		{ mode: "development", cloud: "false" },
		{ mode: "production", cloud: "true" },
		{ mode: "production", cloud: "false" },
	])("does not inject a repository in $mode with cloud=$cloud when unconfigured", async ({ mode, cloud }) => {
		vi.stubEnv("VETTA_CLOUD_ENABLED", cloud);
		if (typeof mainConfig !== "function") throw new Error("Expected a main config factory");
		const config = await mainConfig({ command: "build", mode });
		expect(config.define).toMatchObject({
			"process.env.VETTA_CLOUD_ENABLED": JSON.stringify(cloud),
			"process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY": JSON.stringify(""),
			"process.env.VETTA_OPEN_MARKETPLACE_REF": JSON.stringify("main"),
			"process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL": JSON.stringify(""),
		});
	});

	it("treats an explicitly blank repository as no default source", async () => {
		vi.stubEnv("VETTA_CLOUD_ENABLED", "true");
		vi.stubEnv("VETTA_OPEN_MARKETPLACE_REPOSITORY", "   ");
		if (typeof mainConfig !== "function") throw new Error("Expected a main config factory");
		const config = await mainConfig({ command: "build", mode: "production" });
		expect(config.define?.["process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY"]).toBe(JSON.stringify(""));
	});

	it("preserves explicit distribution overrides with cloud enabled", async () => {
		vi.stubEnv("VETTA_CLOUD_ENABLED", "true");
		vi.stubEnv("VETTA_OPEN_MARKETPLACE_REPOSITORY", "example/fork");
		vi.stubEnv("VETTA_OPEN_MARKETPLACE_REF", "stable");
		if (typeof mainConfig !== "function") throw new Error("Expected a main config factory");
		const config = await mainConfig({ command: "build", mode: "production" });
		expect(config.define).toMatchObject({
			"process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY": JSON.stringify("example/fork"),
			"process.env.VETTA_OPEN_MARKETPLACE_REF": JSON.stringify("stable"),
		});
	});
});
