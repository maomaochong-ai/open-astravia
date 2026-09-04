import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialVault } from "../credentials/credential-vault.js";
import { PluginSecretsStore } from "./plugin-secrets-store.js";

/** 可用的假加密后端：只验证存储行为，不测 safeStorage 本身。 */
const cryptography = {
	backend: "test",
	isAvailable: () => true,
	encrypt: (plainText: string) => Buffer.from(plainText, "utf8").toString("base64"),
	decrypt: (cipherText: string) => Buffer.from(cipherText, "base64").toString("utf8"),
};

let root: string;
let store: PluginSecretsStore;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "plugin-secrets-"));
	store = new PluginSecretsStore(new CredentialVault(root, cryptography));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("PluginSecretsStore", () => {
	it("round-trips a secret and lists only key names", () => {
		store.set("demo", "apiKey", "sk-live-1");

		expect(store.get("demo", "apiKey")).toBe("sk-live-1");
		expect(store.has("demo", "apiKey")).toBe(true);
		expect(store.keys("demo")).toEqual(["apiKey"]);
	});

	it("keeps each plugin inside its own namespace", () => {
		store.set("demo", "apiKey", "sk-demo");
		store.set("other", "apiKey", "sk-other");

		expect(store.get("other", "apiKey")).toBe("sk-other");
		expect(store.keys("demo")).toEqual(["apiKey"]);
		expect(store.get("demo", "apiKey")).toBe("sk-demo");
	});

	it("treats an empty value as a delete so no unreadable record is left behind", () => {
		store.set("demo", "apiKey", "sk-live-1");
		store.set("demo", "apiKey", "");

		expect(store.has("demo", "apiKey")).toBe(false);
		expect(store.get("demo", "apiKey")).toBeUndefined();
		expect(store.keys("demo")).toEqual([]);
	});

	it("clears every secret a plugin owns without touching others", () => {
		store.set("demo", "apiKey", "sk-demo");
		store.set("demo", "token", "tk-demo");
		store.set("other", "apiKey", "sk-other");

		store.clear("demo");

		expect(store.keys("demo")).toEqual([]);
		expect(store.get("other", "apiKey")).toBe("sk-other");
	});

	it("rejects keys that are empty or carry surrounding whitespace", () => {
		expect(() => store.set("demo", " apiKey", "x")).toThrow("Invalid plugin secret key");
		expect(() => store.get("demo", "")).toThrow("Invalid plugin secret key");
	});
});
