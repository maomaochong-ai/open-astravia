/**
 * Persisted credential hashes for one pairing room. The desktop registers the
 * room and is authoritative for the phone's hash; the relay never sees either
 * secret in clear, only SHA-256 digests.
 */
export class RoomAuthorization {
	private static readonly desktopCredentialKey = "desktopCredentialHash";
	private static readonly mobileCredentialKey = "mobileCredentialHash";

	constructor(private readonly state: DurableObjectState) {}

	/**
	 * A fresh room is claimed by the first desktop that also brings the phone's
	 * hash. A known desktop must present the same hash; when it does and brings
	 * a peer hash, the stored phone hash is replaced (re-registration after
	 * expiry, or a rotated phone credential).
	 */
	async authorizeDesktop(candidateHash: string, peerHash?: string): Promise<boolean> {
		let authorized = false;
		await this.state.blockConcurrencyWhile(async () => {
			const storedHash = await this.state.storage.get<string>(RoomAuthorization.desktopCredentialKey);
			if (storedHash === undefined) {
				if (!peerHash) return;
				await this.state.storage.put(RoomAuthorization.desktopCredentialKey, candidateHash);
				await this.state.storage.put(RoomAuthorization.mobileCredentialKey, peerHash);
				authorized = true;
				return;
			}
			if (storedHash !== candidateHash) return;
			if (peerHash) await this.state.storage.put(RoomAuthorization.mobileCredentialKey, peerHash);
			authorized = true;
		});
		return authorized;
	}

	async authorizeMobile(candidateHash: string): Promise<boolean> {
		let authorized = false;
		await this.state.blockConcurrencyWhile(async () => {
			const mobileHash = await this.state.storage.get<string>(RoomAuthorization.mobileCredentialKey);
			authorized = mobileHash !== undefined && mobileHash === candidateHash;
		});
		return authorized;
	}
}
