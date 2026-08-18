import { safeStorage } from "electron";
import type { CredentialCryptography } from "./credential-vault.js";

export class ElectronSafeStorageCryptography implements CredentialCryptography {
	readonly backend = "electron-safe-storage";

	isAvailable(): boolean {
		if (!safeStorage.isEncryptionAvailable()) return false;
		return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
	}

	encrypt(plainText: string): string {
		return safeStorage.encryptString(plainText).toString("base64");
	}

	decrypt(cipherText: string): string {
		return safeStorage.decryptString(Buffer.from(cipherText, "base64"));
	}
}
