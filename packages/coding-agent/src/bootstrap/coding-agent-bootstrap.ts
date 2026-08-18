import type { ThinkingLevel } from "@vetta/agent-core";
import { type Api, type Model, supportsXhigh } from "@vetta/ai";
import type { CodingAgentAuthRuntime } from "../auth/index.js";
import {
	type CodingAgentExtensionRequirements,
	collectCodingAgentExtensionRequirements,
} from "../extensions/compatibility/index.js";
import type { LoadExtensionsResult } from "../extensions/index.js";
import { DEFAULT_SERVER_URL } from "../identity.js";
import {
	type CodingAgentModelRuntime,
	DEFAULT_THINKING_LEVEL,
	findInitialModel,
	resolveCliModel,
	resolveModelScope,
	type ScopedModel,
} from "../models/index.js";
import type { SessionResourceRuntime } from "../resources/index.js";
import type { SettingsError, SettingsRuntime } from "../settings/index.js";
import { type Args, parseArgs } from "./launch-arguments.js";

export interface CodingAgentBootstrapDiagnostics {
	readonly onSettingsError?: (error: SettingsError) => void;
	readonly onExtensionError?: (error: LoadExtensionsResult["errors"][number]) => void;
	readonly onArgumentWarning?: (warning: string) => void;
}

export interface CodingAgentBootstrapResourceRequest {
	readonly cwd: string;
	readonly agentDir: string;
	readonly parsed: Args;
	readonly settings: SettingsRuntime;
}

export type CodingAgentBootstrapResourceFactory = (
	request: CodingAgentBootstrapResourceRequest,
) => SessionResourceRuntime;

export interface CodingAgentBootstrapOptions extends CodingAgentBootstrapDiagnostics {
	readonly args: string[];
	readonly cwd: string;
	readonly agentDir: string;
	readonly settingsManager: SettingsRuntime;
	readonly authStorage: CodingAgentAuthRuntime;
	readonly modelRegistry: CodingAgentModelRuntime;
	readonly createResourceRuntime: CodingAgentBootstrapResourceFactory;
	readonly serverUrlOverride?: string;
}

export interface CodingAgentBootstrap {
	readonly cwd: string;
	readonly agentDir: string;
	readonly parsed: Args;
	readonly settingsManager: SettingsRuntime;
	readonly authStorage: CodingAgentAuthRuntime;
	readonly modelRegistry: CodingAgentModelRuntime;
	readonly resourceLoader: SessionResourceRuntime;
	readonly extensionsResult: LoadExtensionsResult;
	readonly extensionRequirements: CodingAgentExtensionRequirements;
}

export interface CodingAgentInitialModelResolution {
	readonly model: Model<Api> | undefined;
	readonly thinkingLevel: ThinkingLevel;
	readonly scopedModels: readonly ScopedModel[];
	readonly warning: string | undefined;
	readonly error: string | undefined;
}

/** Initialize Coding Agent rules from host-owned state and resource implementations. */
export async function createCodingAgentBootstrap(options: CodingAgentBootstrapOptions): Promise<CodingAgentBootstrap> {
	const { cwd, agentDir, settingsManager, authStorage, modelRegistry } = options;
	const firstPass = parseArgs(options.args);
	for (const error of settingsManager.drainErrors()) options.onSettingsError?.(error);

	let serverUrl = options.serverUrlOverride || settingsManager.getServerUrl();
	if (!serverUrl) {
		settingsManager.setServerUrl(DEFAULT_SERVER_URL);
		serverUrl = DEFAULT_SERVER_URL;
	}
	modelRegistry.setServerUrl(serverUrl);
	modelRegistry.setServerToken(settingsManager.getServerToken());
	modelRegistry.setServerTokenGetter(() => settingsManager.getServerTokenFresh());
	await modelRegistry.loadRemoteModels();

	const resourceLoader = options.createResourceRuntime({
		cwd,
		agentDir,
		parsed: firstPass,
		settings: settingsManager,
	});
	await resourceLoader.reload();

	const extensionsResult = resourceLoader.getExtensions();
	for (const error of extensionsResult.errors) options.onExtensionError?.(error);
	const extensionRequirements = collectCodingAgentExtensionRequirements({
		extensions: extensionsResult.extensions,
		pendingProviderNames: extensionsResult.runtime.pendingProviderRegistrations.map(({ name }) => name),
	});
	for (const { name, config } of extensionsResult.runtime.pendingProviderRegistrations) {
		modelRegistry.registerProvider(name, config);
	}
	extensionsResult.runtime.pendingProviderRegistrations = [];

	const extensionFlags = new Map<string, { type: "boolean" | "string" }>();
	for (const extension of extensionsResult.extensions) {
		for (const [name, flag] of extension.flags) extensionFlags.set(name, { type: flag.type });
	}
	const parsed = parseArgs(options.args, {
		extensionFlags,
		onWarning: options.onArgumentWarning,
	});
	for (const [name, value] of parsed.unknownFlags) {
		extensionsResult.runtime.flagValues.set(name, value);
	}

	return {
		cwd,
		agentDir,
		parsed,
		settingsManager,
		authStorage,
		modelRegistry,
		resourceLoader,
		extensionsResult,
		extensionRequirements,
	};
}

export async function resolveCodingAgentInitialModel(
	bootstrap: CodingAgentBootstrap,
): Promise<CodingAgentInitialModelResolution> {
	const { parsed, modelRegistry, settingsManager } = bootstrap;
	const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
	const scopedModels =
		modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
	let warning: string | undefined;
	let error: string | undefined;
	let model: Model<Api> | undefined;
	let thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;

	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			models: modelRegistry,
		});
		model = resolved.model;
		warning = resolved.warning;
		error = resolved.error;
		if (!parsed.thinking && resolved.thinkingLevel) thinkingLevel = resolved.thinkingLevel;
	}

	if (!model && !error) {
		const initial = await findInitialModel({
			scopedModels,
			isContinuing: parsed.continue === true || parsed.resume === true || parsed.session !== undefined,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			models: modelRegistry,
		});
		model = initial.model;
		thinkingLevel = initial.thinkingLevel;
	}

	if (parsed.thinking) thinkingLevel = parsed.thinking;
	if (model && !model.reasoning) thinkingLevel = "off";
	if (model && thinkingLevel === "xhigh" && !supportsXhigh(model)) thinkingLevel = "high";
	return { model, thinkingLevel, scopedModels, warning, error };
}
