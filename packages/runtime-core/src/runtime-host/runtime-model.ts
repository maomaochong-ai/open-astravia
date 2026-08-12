import type { ThinkingLevel } from "@vetta/agent-core";
import { type Api, type Model, modelsAreEqual, supportsXhigh } from "@vetta/ai";
import type {
	RuntimeSnapshotAcquireContext,
	RuntimeTurnCredentialBinding,
	RuntimeTurnModelBinding,
	RuntimeTurnModelBindingProvider,
} from "../kernel/contracts.js";
import type {
	RuntimeModelSelectionStrategy,
	RuntimeSessionModelController,
	RuntimeSessionModelView,
} from "./session-ports.js";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const THINKING_LEVELS_WITH_XHIGH: readonly ThinkingLevel[] = [...THINKING_LEVELS, "xhigh"];

/** Session 作用域的模型目录；具体 Registry 和远端加载留给组合根适配。 */
export interface RuntimeModelCatalog {
	refresh(): void;
	listAvailable(): readonly Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
}

/** Session 作用域的凭证解析与认证刷新边界。 */
export interface RuntimeModelCredentialResolver {
	resolve(model: Model<Api>): Promise<string | undefined>;
	refreshAuth(token: string | undefined): Promise<void>;
}

export interface RuntimeModelOptions {
	readonly initialModel: Model<Api>;
	readonly initialThinkingLevel: ThinkingLevel;
	readonly catalog: RuntimeModelCatalog;
	readonly credentials: RuntimeModelCredentialResolver;
}

export interface RuntimeModelRuntime
	extends RuntimeSessionModelController,
		RuntimeSessionModelView,
		RuntimeTurnModelBindingProvider {
	readThinkingLevel(): ThinkingLevel;
}

/**
 * Runtime Session 的模型单一事实源。
 *
 * Controller、View、State 和 Turn binding 必须共享同一实例，避免宿主显示状态与
 * 实际模型执行分离。bind() 返回独立冻结对象，后续切模不会修改活动 Turn。
 */
export class RuntimeModel implements RuntimeModelRuntime {
	private readonly catalog: RuntimeModelCatalog;
	private readonly credentials: RuntimeModelCredentialResolver;
	private currentModel: Model<Api>;
	private thinkingLevel: ThinkingLevel;
	private configurationRevision = 0;
	private credentialRevocationRevision = 0;

	constructor(options: RuntimeModelOptions) {
		this.catalog = options.catalog;
		this.credentials = options.credentials;
		this.currentModel = options.initialModel;
		this.thinkingLevel = this.clampThinkingLevel(options.initialThinkingLevel);
	}

	async selectModel(modelKey: string, strategy: RuntimeModelSelectionStrategy): Promise<void> {
		const model = this.findModel(modelKey);
		if (!model) return;
		if (strategy === "if-changed" && modelsAreEqual(this.currentModel, model)) return;

		const revision = ++this.configurationRevision;
		const apiKey = await this.credentials.resolve(model);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}
		if (revision !== this.configurationRevision) return;
		this.currentModel = model;
		this.thinkingLevel = clampThinkingLevelForModel(this.thinkingLevel, model);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.configurationRevision += 1;
		this.thinkingLevel = this.clampThinkingLevel(level);
	}

	async refreshAuth(token: string | undefined): Promise<void> {
		if (token === undefined) this.credentialRevocationRevision += 1;
		await this.credentials.refreshAuth(token);
	}

	readCurrentModel(): Model<Api> {
		return this.currentModel;
	}

	readThinkingLevel(): ThinkingLevel {
		return this.thinkingLevel;
	}

	refreshAvailableModels(): void {
		this.catalog.refresh();
	}

	readAvailableModels(): readonly Model<Api>[] {
		return [...this.catalog.listAvailable()];
	}

	resolveApiKey(model: Model<Api>): Promise<string | undefined> {
		return this.credentials.resolve(model);
	}

	async bind(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeTurnModelBinding> {
		const requested = context?.request?.model;
		if (!requested?.key && requested?.reasoning === undefined) {
			const model = this.currentModel;
			const thinkingLevel = this.thinkingLevel;
			return createModelBinding(model, thinkingLevel, await this.bindCredential(model));
		}

		const revision = ++this.configurationRevision;
		const model = requested.key ? (this.findModel(requested.key) ?? this.currentModel) : this.currentModel;
		const requestedThinkingLevel = (requested.reasoning ?? this.thinkingLevel) as ThinkingLevel;
		const apiKey = await this.credentials.resolve(model);
		if (requested.key && !modelsAreEqual(model, this.currentModel)) {
			if (!apiKey) throw new Error(`No API key for ${model.provider}/${model.id}`);
		}
		const thinkingLevel = clampThinkingLevelForModel(requestedThinkingLevel, model);
		if (revision === this.configurationRevision) {
			this.currentModel = model;
			this.thinkingLevel = thinkingLevel;
		}
		return createModelBinding(model, thinkingLevel, this.createCredentialBinding(apiKey));
	}

	private async bindCredential(model: Model<Api>): Promise<RuntimeTurnCredentialBinding> {
		return this.createCredentialBinding(await this.credentials.resolve(model));
	}

	private createCredentialBinding(apiKey: string | undefined): RuntimeTurnCredentialBinding {
		const revision = this.credentialRevocationRevision;
		return Object.freeze({
			resolve: () => (revision === this.credentialRevocationRevision ? apiKey : undefined),
		});
	}

	private findModel(modelKey: string): Model<Api> | undefined {
		const [provider, ...rest] = modelKey.split("/");
		const modelId = rest.join("/");
		return (
			this.catalog
				.listAvailable()
				.find((candidate) => candidate.provider === provider && candidate.id === modelId) ??
			this.catalog.find(provider, modelId)
		);
	}

	private clampThinkingLevel(level: ThinkingLevel): ThinkingLevel {
		return clampThinkingLevelForModel(level, this.currentModel);
	}
}

function createModelBinding(
	model: Model<Api>,
	thinkingLevel: ThinkingLevel,
	credential: RuntimeTurnCredentialBinding,
): RuntimeTurnModelBinding {
	return Object.freeze({
		model,
		reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
		credential,
	});
}

function clampThinkingLevelForModel(level: ThinkingLevel, model: Model<Api>): ThinkingLevel {
	const availableLevels = availableThinkingLevelsForModel(model);
	if (!THINKING_LEVELS_WITH_XHIGH.includes(level)) return level;
	if (availableLevels.includes(level)) return level;

	const requestedIndex = THINKING_LEVELS_WITH_XHIGH.indexOf(level);
	for (let index = requestedIndex; index < THINKING_LEVELS_WITH_XHIGH.length; index++) {
		const candidate = THINKING_LEVELS_WITH_XHIGH[index];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let index = requestedIndex - 1; index >= 0; index--) {
		const candidate = THINKING_LEVELS_WITH_XHIGH[index];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}

function availableThinkingLevelsForModel(model: Model<Api>): readonly ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return supportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
}
