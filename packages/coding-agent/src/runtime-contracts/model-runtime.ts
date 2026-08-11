import type { Api, Model } from "@vetta/ai";

/** Composition 对宿主模型目录的最小依赖。 */
export interface CodingAgentRuntimeModelSource {
	refresh(): void;
	getAvailable(): readonly Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
	getApiKey(model: Model<Api>): Promise<string | undefined>;
	setServerToken(token: string | undefined): void;
	loadRemoteModels(): Promise<"unauthorized" | undefined>;
}
