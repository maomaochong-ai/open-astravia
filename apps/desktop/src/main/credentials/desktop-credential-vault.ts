import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { CredentialVault } from "./credential-vault.js";
import { ElectronSafeStorageCryptography } from "./electron-safe-storage-cryptography.js";

let desktopCredentialVault: CredentialVault | undefined;

export function getDesktopCredentialVault(): CredentialVault {
	desktopCredentialVault ??= new CredentialVault(
		join(getVettaHomePath(), "desktop-app", "credentials"),
		new ElectronSafeStorageCryptography(),
	);
	return desktopCredentialVault;
}
