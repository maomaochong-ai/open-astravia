import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CredentialCryptography, CredentialVault } from "./credential-vault.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CredentialVault", () => {
	it("persists encrypted records without plaintext", () => {
		const directory = createTemporaryDirectory();
		const vault = new CredentialVault(directory, new TestCryptography());
		const ref = { namespace: "models", ownerId: "openai", name: "api-key" };

		vault.put(ref, "sk-secret");

		expect(vault.get(ref)).toBe("sk-secret");
		const recordPath = join(directory, requireSingleRecord(directory));
		expect(readFileSync(recordPath, "utf8")).not.toContain("sk-secret");
	});

	it("isolates records by namespace and supports deletion", () => {
		const directory = createTemporaryDirectory();
		const vault = new CredentialVault(directory, new TestCryptography());
		const modelRef = { namespace: "models", ownerId: "openai", name: "api-key" };
		const webhookRef = { namespace: "webhook", ownerId: "endpoint", name: "sign-secret" };
		vault.put(modelRef, "model-secret");
		vault.put(webhookRef, "webhook-secret");

		expect(vault.list("models")).toEqual([{ ref: modelRef, value: "model-secret" }]);
		vault.remove(modelRef);
		expect(vault.has(modelRef)).toBe(false);
		expect(vault.get(webhookRef)).toBe("webhook-secret");
	});

	it("refuses writes when secure storage is unavailable", () => {
		const directory = createTemporaryDirectory();
		const vault = new CredentialVault(directory, new TestCryptography(false));

		expect(() => vault.put({ namespace: "models", ownerId: "openai", name: "api-key" }, "secret")).toThrow(
			"Secure credential storage is unavailable",
		);
	});
});

class TestCryptography implements CredentialCryptography {
	readonly backend = "test";

	constructor(private readonly available = true) {}

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

function createTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "vetta-credential-vault-"));
	temporaryDirectories.push(directory);
	return directory;
}

function requireSingleRecord(directory: string): string {
	const files = readdirSync(directory);
	expect(files).toHaveLength(1);
	const file = files[0];
	if (!file) throw new Error("Credential record was not created");
	return file;
}
