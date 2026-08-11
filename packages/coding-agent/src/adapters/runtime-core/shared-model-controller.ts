import type { RuntimeSharedModelController } from "@vetta/runtime-core";

export interface CodingAgentSharedModelSource {
	setServerToken(token: string | undefined): void;
	loadRemoteModels(): Promise<"unauthorized" | undefined>;
}

export class CodingAgentSharedModelController implements RuntimeSharedModelController {
	constructor(private readonly models: CodingAgentSharedModelSource) {}

	async refreshAuth(token: string | undefined): Promise<void> {
		this.models.setServerToken(token);
		await this.models.loadRemoteModels();
	}

	refreshInBackground(): void {
		void this.models.loadRemoteModels();
	}
}
