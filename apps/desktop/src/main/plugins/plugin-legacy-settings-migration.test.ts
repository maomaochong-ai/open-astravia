import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = { path: "" };
const written = new Map<string, unknown>();
const existing = new Map<string, unknown>();

vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => home.path }));
vi.mock("./plugin-storage-service.js", () => ({
	readPluginJson: async (pluginId: string, key: string) => existing.get(`${pluginId}:${key}`) ?? null,
	writePluginJson: async (pluginId: string, key: string, value: unknown) => {
		written.set(`${pluginId}:${key}`, value);
	},
}));

const { migrateLegacyPluginSettings } = await import("./plugin-legacy-settings-migration.js");

const logger = { info: vi.fn(), warn: vi.fn() };

function writeLegacy(content: string): string {
	const path = join(home.path, "plugin-settings.json");
	writeFileSync(path, content);
	return path;
}

beforeEach(() => {
	home.path = mkdtempSync(join(tmpdir(), "legacy-plugin-settings-"));
	written.clear();
	existing.clear();
	vi.clearAllMocks();
});

afterEach(() => {
	rmSync(home.path, { recursive: true, force: true });
});

describe("migrateLegacyPluginSettings", () => {
	it("moves each plugin's stored values into its private storage and archives the source file", async () => {
		const legacyPath = writeLegacy(JSON.stringify({ demo: { baseUrl: "http://a" }, other: { mode: "safe" } }));

		await migrateLegacyPluginSettings(logger);

		expect(written.get("demo:settings")).toEqual({ baseUrl: "http://a" });
		expect(written.get("other:settings")).toEqual({ mode: "safe" });
		expect(existsSync(legacyPath)).toBe(false);
		expect(existsSync(join(home.path, "plugin-settings.migrated.json"))).toBe(true);
	});

	it("never overwrites settings a plugin already wrote itself", async () => {
		existing.set("demo:settings", { baseUrl: "http://new" });
		writeLegacy(JSON.stringify({ demo: { baseUrl: "http://old" } }));

		await migrateLegacyPluginSettings(logger);

		expect(written.has("demo:settings")).toBe(false);
	});

	it("is a no-op when there is nothing to migrate", async () => {
		await migrateLegacyPluginSettings(logger);
		expect(written.size).toBe(0);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("keeps the source file when it cannot be parsed", async () => {
		const legacyPath = writeLegacy("{ not json");

		await migrateLegacyPluginSettings(logger);

		expect(existsSync(legacyPath)).toBe(true);
		expect(logger.warn).toHaveBeenCalledOnce();
	});
});
