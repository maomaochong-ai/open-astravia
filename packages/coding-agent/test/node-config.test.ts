import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, ENV_PACKAGE_DIR, getAgentDir, getPackageDir, PACKAGE_NAME, VERSION } from "../src/config.js";

describe("Coding Agent Node config compatibility facade", () => {
	const originalAgentDir = process.env[ENV_AGENT_DIR];
	const originalPackageDir = process.env[ENV_PACKAGE_DIR];
	const originalPiPackageDir = process.env.PI_PACKAGE_DIR;

	afterEach(() => {
		restoreEnvironment(ENV_AGENT_DIR, originalAgentDir);
		restoreEnvironment(ENV_PACKAGE_DIR, originalPackageDir);
		restoreEnvironment("PI_PACKAGE_DIR", originalPiPackageDir);
	});

	it("reads package identity from the package manifest", () => {
		const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

		expect(PACKAGE_NAME).toBe(Reflect.get(manifest as object, "name"));
		expect(VERSION).toBe(Reflect.get(manifest as object, "version"));
	});

	it("resolves the source package root when no package override is configured", () => {
		delete process.env[ENV_PACKAGE_DIR];
		delete process.env.PI_PACKAGE_DIR;

		expect(normalizePath(getPackageDir())).toBe(normalizePath(fileURLToPath(new URL("..", import.meta.url))));
	});

	it("honors the explicit Agent directory override", () => {
		process.env[ENV_AGENT_DIR] = "C:/isolated/vetta-agent";

		expect(getAgentDir()).toBe("C:/isolated/vetta-agent");
	});
});

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/\/$/u, "").toLowerCase();
}
