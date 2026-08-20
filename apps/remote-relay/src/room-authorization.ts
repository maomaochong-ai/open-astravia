export class RoomAuthorization {
	private static readonly legacyCredentialKey = "credentialHash";
	private static readonly desktopCredentialKey = "desktopCredentialHash";
	private static readonly bootstrapCredentialKey = "bootstrapCredentialHash";
	private static readonly mobileCredentialKey = "mobileCredentialHash";

	constructor(private readonly state: DurableObjectState) {}

	async authorizeDesktop(candidateHash: string, bootstrapHash?: string): Promise<boolean> {
		let authorized = false;
		await this.state.blockConcurrencyWhile(async () => {
			const storedHash = await this.state.storage.get<string>(RoomAuthorization.desktopCredentialKey);
			const legacyHash = await this.state.storage.get<string>(RoomAuthorization.legacyCredentialKey);
			if (storedHash === undefined && legacyHash === undefined) {
				if (bootstrapHash) {
					await this.state.storage.put(RoomAuthorization.desktopCredentialKey, candidateHash);
					await this.state.storage.put(RoomAuthorization.bootstrapCredentialKey, bootstrapHash);
				} else {
					await this.state.storage.put(RoomAuthorization.legacyCredentialKey, candidateHash);
				}
				authorized = true;
				return;
			}
			authorized = storedHash === candidateHash || legacyHash === candidateHash;
		});
		return authorized;
	}

	async authorizeMobile(candidateHash: string): Promise<"bootstrap" | "resume" | "legacy" | false> {
		let mode: "bootstrap" | "resume" | "legacy" | false = false;
		await this.state.blockConcurrencyWhile(async () => {
			const mobileHash = await this.state.storage.get<string>(RoomAuthorization.mobileCredentialKey);
			const bootstrapHash = await this.state.storage.get<string>(RoomAuthorization.bootstrapCredentialKey);
			const desktopHash = await this.state.storage.get<string>(RoomAuthorization.desktopCredentialKey);
			const legacyHash = await this.state.storage.get<string>(RoomAuthorization.legacyCredentialKey);
			if (mobileHash === candidateHash) mode = "resume";
			else if (bootstrapHash === candidateHash) mode = "bootstrap";
			else if (
				legacyHash === candidateHash ||
				(mobileHash === undefined && bootstrapHash === undefined && desktopHash === candidateHash)
			)
				mode = "legacy";
		});
		return mode;
	}

	async consumeBootstrap(resumeHash?: string): Promise<boolean> {
		let consumed = false;
		await this.state.blockConcurrencyWhile(async () => {
			const bootstrapHash = await this.state.storage.get<string>(RoomAuthorization.bootstrapCredentialKey);
			if (bootstrapHash === undefined) return;
			if (!resumeHash) return;
			await this.state.storage.put(RoomAuthorization.mobileCredentialKey, resumeHash);
			await this.state.storage.delete(RoomAuthorization.bootstrapCredentialKey);
			consumed = true;
		});
		return consumed;
	}
}
