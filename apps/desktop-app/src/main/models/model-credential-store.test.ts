import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CredentialCryptography, CredentialVault } from "../credentials/credential-vault.js";
import { DesktopModelCredentialStore } from "./model-credential-store.js";

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));

vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: vi.fn() }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ warn: logWarn }) }));

const temporaryDirectories: string[] = [];

afterEach(() => {
	logWarn.mockClear();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("DesktopModelCredentialStore", () => {
	it("treats credentials encrypted with another safeStorage key as unavailable", () => {
		const vault = new CredentialVault(createTemporaryDirectory(), new UndecryptableCryptography());
		const store = new DesktopModelCredentialStore(vault);
		store.set("deepseek-credential", "secret");

		expect(store.get("deepseek-credential")).toBeUndefined();
		expect(logWarn).toHaveBeenCalledWith(
			"模型凭据无法解密，将按未配置处理",
			expect.objectContaining({ credentialRef: "deepseek-credential" }),
		);
	});
});

class UndecryptableCryptography implements CredentialCryptography {
	readonly backend = "test";

	isAvailable(): boolean {
		return true;
	}

	encrypt(plainText: string): string {
		return Buffer.from(plainText, "utf8").toString("base64");
	}

	decrypt(): string {
		throw new Error("ciphertext belongs to another safeStorage key");
	}
}

function createTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "vetta-model-credential-store-"));
	temporaryDirectories.push(directory);
	return directory;
}
