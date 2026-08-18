import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginSettingSchema } from "../../preload/api-types/plugins.js";
import { type CredentialCryptography, CredentialVault } from "../credentials/credential-vault.js";
import { PluginSettingsStore } from "./plugin-settings-store.js";

const schema: PluginSettingSchema[] = [
	{ key: "provider", type: "string", title: "Provider", default: "openai" },
	{ key: "apiKey", type: "secret", title: "API key" },
];

describe("PluginSettingsStore", () => {
	it("stores declared secrets in the encrypted credential vault", () => {
		withStore(({ settings, settingsPath, vault }) => {
			const effective = settings.set("content-creation", { apiKey: "sk-secret", provider: "custom" }, schema);

			expect(effective).toEqual({ provider: "custom", apiKey: "sk-secret" });
			expect(readFileSync(settingsPath, "utf8")).not.toContain("sk-secret");
			expect(vault.get({ namespace: "plugin-settings", ownerId: "content-creation", name: "apiKey" })).toBe(
				"sk-secret",
			);
		});
	});

	it("migrates legacy plaintext secrets on read", () => {
		withStore(({ settings, settingsPath }) => {
			writeFileSync(settingsPath, JSON.stringify({ "content-creation": { apiKey: "legacy", provider: "openai" } }));

			expect(settings.get("content-creation", schema)).toEqual({ provider: "openai", apiKey: "legacy" });
			expect(readFileSync(settingsPath, "utf8")).not.toContain("legacy");
		});
	});

	it("refuses new secret writes when secure storage is unavailable", () => {
		withStore(({ settings }) => {
			expect(() => settings.set("content-creation", { apiKey: "secret" }, schema)).toThrow(
				"Secure credential storage is unavailable",
			);
		}, false);
	});
});

function withStore(
	run: (fixture: { settings: PluginSettingsStore; settingsPath: string; vault: CredentialVault }) => void,
	available = true,
): void {
	const directory = mkdtempSync(join(tmpdir(), "vetta-plugin-settings-"));
	try {
		const settingsPath = join(directory, "plugin-settings.json");
		const vault = new CredentialVault(join(directory, "credentials"), new TestCryptography(available));
		run({ settings: new PluginSettingsStore(settingsPath, vault), settingsPath, vault });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

class TestCryptography implements CredentialCryptography {
	readonly backend = "test";

	constructor(private readonly available: boolean) {}

	isAvailable(): boolean {
		return this.available;
	}

	encrypt(plainText: string): string {
		return Buffer.from(plainText, "utf8").toString("base64");
	}

	decrypt(cipherText: string): string {
		return Buffer.from(cipherText, "base64").toString("utf8");
	}
}
