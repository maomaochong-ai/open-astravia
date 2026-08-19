export class RoomAuthorization {
	private static readonly credentialKey = "credentialHash";

	constructor(private readonly state: DurableObjectState) {}

	async authorize(initializer: boolean, candidateHash: string): Promise<boolean> {
		let authorized = false;
		await this.state.blockConcurrencyWhile(async () => {
			const storedHash = await this.state.storage.get<string>(RoomAuthorization.credentialKey);
			if (storedHash === undefined && initializer) {
				await this.state.storage.put(RoomAuthorization.credentialKey, candidateHash);
				authorized = true;
				return;
			}
			authorized = storedHash === candidateHash;
		});
		return authorized;
	}
}
