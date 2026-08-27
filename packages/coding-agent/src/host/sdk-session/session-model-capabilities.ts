import type { ThinkingLevel } from "@vetta/agent-core";
import { type Api, type Model, modelsAreEqual, supportsXhigh } from "@vetta/ai";
import type { RuntimeHostSession } from "@vetta/runtime-core";
import type { CodingAgentModelCycleResult, CodingAgentScopedModel } from "../../public-api/sdk/sdk-session-contract.js";
import type { CodingAgentSdkSessionCapabilitySettings } from "./session-capability-options.js";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const THINKING_LEVELS_WITH_XHIGH: readonly ThinkingLevel[] = [...THINKING_LEVELS, "xhigh"];

export interface CodingAgentSessionModelCapabilitiesOptions {
	readonly readSession: () => RuntimeHostSession;
	readonly readAvailableModels: () => Promise<readonly Model<Api>[]>;
	readonly readScopedModels: () => readonly CodingAgentScopedModel[];
	readonly settings?: CodingAgentSdkSessionCapabilitySettings;
}

export class CodingAgentSessionModelCapabilities {
	constructor(private readonly options: CodingAgentSessionModelCapabilitiesOptions) {}

	async selectModel(provider: string, modelId: string): Promise<Model<Api> | undefined> {
		const model = (await this.options.readAvailableModels()).find(
			(candidate) => candidate.provider === provider && candidate.id === modelId,
		);
		if (!model) return undefined;
		await this.options.readSession().selectModel(`${provider}/${modelId}`, "always");
		this.options.settings?.setDefaultModelAndProvider(provider, modelId);
		return this.options.readSession().readCurrentModel();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		const session = this.options.readSession();
		session.setThinkingLevel(level);
		this.options.settings?.setDefaultThinkingLevel(session.readState().thinkingLevel);
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<CodingAgentModelCycleResult | undefined> {
		const session = this.options.readSession();
		const scopedModels = this.options.readScopedModels();
		const candidates =
			scopedModels.length > 0
				? await readUsableScopedModels(scopedModels, (model) => session.resolveModelApiKey(model))
				: (await this.options.readAvailableModels()).map((model) => ({
						model,
						thinkingLevel: session.readState().thinkingLevel,
					}));
		if (candidates.length <= 1) return undefined;
		const current = session.readCurrentModel();
		let currentIndex = candidates.findIndex((candidate) => modelsAreEqual(candidate.model, current));
		if (currentIndex === -1) currentIndex = 0;
		const offset = direction === "forward" ? 1 : -1;
		const next = candidates[(currentIndex + offset + candidates.length) % candidates.length];
		await session.selectModel(`${next.model.provider}/${next.model.id}`, "always");
		session.setThinkingLevel(next.thinkingLevel);
		const thinkingLevel = session.readState().thinkingLevel;
		this.options.settings?.setDefaultModelAndProvider(next.model.provider, next.model.id);
		this.options.settings?.setDefaultThinkingLevel(thinkingLevel);
		return { model: next.model, thinkingLevel, isScoped: scopedModels.length > 0 };
	}

	cycleThinkingLevel(): ThinkingLevel | undefined {
		const session = this.options.readSession();
		const state = session.readState();
		const levels = availableThinkingLevels(session.readCurrentModel());
		if (levels.length === 1) return undefined;
		const next = levels[(levels.indexOf(state.thinkingLevel) + 1) % levels.length];
		session.setThinkingLevel(next);
		this.options.settings?.setDefaultThinkingLevel(next);
		return next;
	}

	readAvailableThinkingLevels(): readonly ThinkingLevel[] {
		return availableThinkingLevels(this.options.readSession().readCurrentModel());
	}

	supportsXhighThinking(): boolean {
		const model = this.options.readSession().readCurrentModel();
		return model ? supportsXhigh(model) : false;
	}

	supportsThinking(): boolean {
		return !!this.options.readSession().readCurrentModel()?.reasoning;
	}
}

function availableThinkingLevels(model: Model<Api> | undefined): readonly ThinkingLevel[] {
	if (!model?.reasoning) return ["off"];
	return supportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
}

async function readUsableScopedModels(
	scopedModels: readonly CodingAgentScopedModel[],
	resolveApiKey: (model: Model<Api>) => Promise<string | undefined>,
): Promise<CodingAgentScopedModel[]> {
	const usable: CodingAgentScopedModel[] = [];
	for (const scoped of scopedModels) {
		if (await resolveApiKey(scoped.model)) usable.push(scoped);
	}
	return usable;
}
