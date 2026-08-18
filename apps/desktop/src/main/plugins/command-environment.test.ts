import { afterEach, describe, expect, it } from "vitest";
import { createPluginCommandEnvironment } from "./command-environment.js";

const MANAGED_KEYS = [
	"npm_config_registry",
	"npm_config_cache",
	"npm_config_prefix",
	"npm_config_userconfig",
	"NPM_CONFIG_USERCONFIG",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
	if (!saved.has(key)) saved.set(key, process.env[key]);
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

afterEach(() => {
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	saved.clear();
});

describe("plugin command environment", () => {
	it("forwards the managed npm registry/cache so plugin installs use the configured mirror", () => {
		setEnv("npm_config_registry", "https://registry.example.test/");
		setEnv("npm_config_cache", "/managed/npm-cache");
		setEnv("npm_config_prefix", "/managed/npm-global");

		const env = createPluginCommandEnvironment();

		expect(env.npm_config_registry).toBe("https://registry.example.test/");
		expect(env.npm_config_cache).toBe("/managed/npm-cache");
		expect(env.npm_config_prefix).toBe("/managed/npm-global");
	});

	it("forwards the managed npm userconfig (Windows shim path)", () => {
		setEnv("npm_config_userconfig", "/managed/.npmrc");
		setEnv("NPM_CONFIG_USERCONFIG", "/managed/.npmrc");

		const env = createPluginCommandEnvironment();

		expect(env.npm_config_userconfig).toBe("/managed/.npmrc");
		expect(env.NPM_CONFIG_USERCONFIG).toBe("/managed/.npmrc");
	});

	it("omits managed npm keys the host never configured", () => {
		for (const key of MANAGED_KEYS) setEnv(key, undefined);

		const env = createPluginCommandEnvironment();

		for (const key of MANAGED_KEYS) expect(env).not.toHaveProperty(key);
	});

	it("keeps caller overrides above inherited values and still drops unrelated host env", () => {
		setEnv("npm_config_registry", "https://registry.example.test/");
		setEnv("VETTA_SECRET_TOKEN", "must-not-leak");

		const env = createPluginCommandEnvironment({ npm_config_registry: "https://caller.example.test/" });

		expect(env.npm_config_registry).toBe("https://caller.example.test/");
		expect(env).not.toHaveProperty("VETTA_SECRET_TOKEN");
	});
});
