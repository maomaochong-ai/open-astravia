import type { CredentialVault } from "../../credentials/credential-vault.js";
import { getDesktopCredentialVault } from "../../credentials/desktop-credential-vault.js";

const CREDENTIAL_NAMESPACE = "github-marketplace";
const CREDENTIAL_NAME = "contents-token";
const MAX_GITHUB_TOKEN_LENGTH = 1024;

export interface GitHubMarketplaceCredentialStore {
	has(sourceId: string): boolean;
	get(sourceId: string): string | undefined;
	set(sourceId: string, token: string): void;
	remove(sourceId: string): void;
}

function credentialRef(sourceId: string) {
	return { namespace: CREDENTIAL_NAMESPACE, ownerId: sourceId, name: CREDENTIAL_NAME } as const;
}

export class DesktopGitHubMarketplaceCredentialStore implements GitHubMarketplaceCredentialStore {
	constructor(private readonly vault: CredentialVault) {}

	has(sourceId: string): boolean {
		return this.vault.has(credentialRef(sourceId));
	}

	get(sourceId: string): string | undefined {
		return this.vault.get(credentialRef(sourceId));
	}

	set(sourceId: string, token: string): void {
		const value = token.trim();
		if (!value) return;
		if (value.length > MAX_GITHUB_TOKEN_LENGTH) throw new Error("GitHub credential is too long");
		this.vault.put(credentialRef(sourceId), value, {
			kind: "github-token",
			consumer: "marketplace",
		});
	}

	remove(sourceId: string): void {
		this.vault.remove(credentialRef(sourceId));
	}
}

let desktopCredentialStore: DesktopGitHubMarketplaceCredentialStore | undefined;

export function getGitHubMarketplaceCredentialStore(): DesktopGitHubMarketplaceCredentialStore {
	desktopCredentialStore ??= new DesktopGitHubMarketplaceCredentialStore(getDesktopCredentialVault());
	return desktopCredentialStore;
}
