import type { ThinkingLevel } from "@vetta/agent-core";
import { type Api, type Model, modelsAreEqual, supportsXhigh } from "@vetta/ai";
import type { RuntimeTurnModelBinding, RuntimeTurnModelBindingProvider } from "../kernel/contracts.js";
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

	constructor(options: RuntimeModelOptions) {
		this.catalog = options.catalog;
		this.credentials = options.credentials;
		this.currentModel = options.initialModel;
		this.thinkingLevel = this.clampThinkingLevel(options.initialThinkingLevel);
	}

	async selectModel(modelKey: string, strategy: RuntimeModelSelectionStrategy): Promise<void> {
		const [provider, ...rest] = modelKey.split("/");
		const modelId = rest.join("/");
		const model =
			this.catalog
				.listAvailable()
				.find((candidate) => candidate.provider === provider && candidate.id === modelId) ??
			this.catalog.find(provider, modelId);
		if (!model) return;
		if (strategy === "if-changed" && modelsAreEqual(this.currentModel, model)) return;

		const apiKey = await this.credentials.resolve(model);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		this.currentModel = model;
		this.thinkingLevel = this.clampThinkingLevel(this.thinkingLevel);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.thinkingLevel = this.clampThinkingLevel(level);
	}

	async refreshAuth(token: string | undefined): Promise<void> {
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

	bind(): RuntimeTurnModelBinding {
		return Object.freeze({
			model: this.currentModel,
			reasoning: this.thinkingLevel === "off" ? undefined : this.thinkingLevel,
		});
	}

	private clampThinkingLevel(level: ThinkingLevel): ThinkingLevel {
		const availableLevels = this.availableThinkingLevels();
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

	private availableThinkingLevels(): readonly ThinkingLevel[] {
		if (!this.currentModel.reasoning) return ["off"];
		return supportsXhigh(this.currentModel) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
	}
}
