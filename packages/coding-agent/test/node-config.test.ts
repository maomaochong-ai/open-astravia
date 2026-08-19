import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	ENV_AGENT_DIR,
	ENV_PACKAGE_DIR,
	getAgentDir,
	getPackageDir,
	PACKAGE_NAME,
	resolveCodingAgentVersion,
	VERSION,
} from "../src/config.js";

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

	it("degrades to an unknown version when the manifest belongs to a host bundle", () => {
		// Electron 打包后 walk-up 命中 app.asar/package.json（name: "vetta"）。
		expect(resolveCodingAgentVersion({ name: "vetta", version: "0.5.42" })).toBe("0.0.0");
		expect(resolveCodingAgentVersion(undefined)).toBe("0.0.0");
		expect(resolveCodingAgentVersion({ name: PACKAGE_NAME })).toBe("0.0.0");
	});

	it("keeps the version when the manifest is the coding-agent package", () => {
		expect(resolveCodingAgentVersion({ name: PACKAGE_NAME, version: "1.2.3" })).toBe("1.2.3");
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
