import type { Api, Model } from "@vetta/ai";
import type { RuntimeModelCatalog, RuntimeModelCredentialResolver } from "@vetta/runtime-core";
import type { CodingAgentRuntimeModelSource } from "../../runtime-contracts/index.js";

export type { CodingAgentRuntimeModelSource } from "../../runtime-contracts/index.js";

export class CodingAgentRuntimeModelAdapter implements RuntimeModelCatalog, RuntimeModelCredentialResolver {
	constructor(private readonly models: CodingAgentRuntimeModelSource) {}

	refresh(): void {
		this.models.refresh();
	}

	listAvailable(): readonly Model<Api>[] {
		return [...this.models.getAvailable()];
	}

	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find(provider, modelId);
	}

	resolve(model: Model<Api>): Promise<string | undefined> {
		return this.models.getApiKey(model);
	}

	async refreshAuth(token: string | undefined): Promise<void> {
		this.models.setServerToken(token);
		await this.models.loadRemoteModels();
	}
}
