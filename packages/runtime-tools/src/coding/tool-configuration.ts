import type {
	RuntimeConfigurationSnapshot,
	RuntimeConfigurationSnapshotLease,
	RuntimeConfigurationSnapshotSource,
} from "@vetta/runtime-core/configuration";
import type {
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
	RuntimeToolTurnBinding,
} from "@vetta/runtime-core/kernel";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "@vetta/runtime-core/observation";
import { CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION, CODING_TOOL_CONFIGURATION_OBSERVATION } from "./observations.js";
import type { CodingToolConfigurationAssociation, CodingToolRegistration } from "./tool-registration.js";

export const CODING_TOOL_CONFIGURATION_ERROR_CODES = {
	INVALID_BINDING: "CODING_TOOL_CONFIGURATION_INVALID_BINDING",
	MISSING_REQUIRED: "CODING_TOOL_CONFIGURATION_MISSING_REQUIRED",
	TOOL_NAME_CHANGED: "CODING_TOOL_CONFIGURATION_TOOL_NAME_CHANGED",
} as const;

export type CodingToolConfigurationErrorCode =
	(typeof CODING_TOOL_CONFIGURATION_ERROR_CODES)[keyof typeof CODING_TOOL_CONFIGURATION_ERROR_CODES];

export class CodingToolConfigurationError extends Error {
	readonly code: CodingToolConfigurationErrorCode;

	constructor(code: CodingToolConfigurationErrorCode, message: string) {
		super(message);
		this.name = "CodingToolConfigurationError";
		this.code = code;
	}
}

/** 必须在调用返回前同步捕获 published pointer，与同步 Tool bindForTurn 合同一致。 */
export type RuntimeToolConfigurationSnapshotSource = RuntimeConfigurationSnapshotSource;

export interface CodingToolConfigurationBindContext<TInput extends object> {
	readonly tool: RuntimeToolDefinition<TInput>;
	readonly configuration: RuntimeConfigurationSnapshot;
	readonly turn: RuntimeSnapshotAcquireContext;
}

export type CodingToolConfigurationMissingPolicy = "fail" | "use-unconfigured";

export interface CodingToolConfigurationAdapterOptions<TInput extends object> {
	readonly association: CodingToolConfigurationAssociation;
	readonly source: RuntimeToolConfigurationSnapshotSource;
	readonly configure: (context: CodingToolConfigurationBindContext<TInput>) => RuntimeToolDefinition<TInput>;
	/** requiredConfigurationIds 非空时必须显式选择，避免安全配置被静默绕过。 */
	readonly onMissingConfiguration?: CodingToolConfigurationMissingPolicy;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/**
 * 用 Decorator 为原生或 Legacy Coding Tool 增加 Turn-bound 配置。
 *
 * 未调用本函数的 Tool 完全不参与配置中心；底层 Tool 已有 bind/release 时会被组合而不是覆盖。
 */
export function withCodingToolConfiguration<TInput extends object>(
	registration: CodingToolRegistration<TInput>,
	options: CodingToolConfigurationAdapterOptions<TInput>,
): CodingToolRegistration<TInput> {
	const association = normalizeAssociation(options.association, options.onMissingConfiguration);
	const baseTool = registration.tool;
	const configuredTool: RuntimeToolDefinition<TInput> = {
		...baseTool,
		bindForTurn(context) {
			let configurationLease: RuntimeConfigurationSnapshotLease;
			try {
				configurationLease = options.source.acquire({
					scopeId: context.sessionId,
					bindingId: context.operationId,
					signal: context.signal,
				});
			} catch (error) {
				observeFailure(options, baseTool.name, association, error);
				throw error;
			}

			let toolBinding: RuntimeToolTurnBinding<TInput> | undefined;
			try {
				toolBinding = baseTool.bindForTurn?.(context);
				const turnTool = toolBinding?.tool ?? baseTool;
				const missing = association.requiredConfigurationIds.filter(
					(configurationId) => configurationLease.snapshot.get(configurationId) === undefined,
				);
				if (missing.length > 0) {
					if (options.onMissingConfiguration === "fail") {
						throw new CodingToolConfigurationError(
							CODING_TOOL_CONFIGURATION_ERROR_CODES.MISSING_REQUIRED,
							`Coding Tool ${baseTool.name} is missing required Runtime Configuration: ${missing.join(", ")}`,
						);
					}
					options.observationPublisher?.record(CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION, {
						operation: "bind",
						phase: "fallback",
						toolName: baseTool.name,
						support: association.support,
						configurationCount: association.configurationIds.length,
						missingConfigurationIds: Object.freeze(missing),
					});
					return createBinding(turnTool, configurationLease, toolBinding);
				}

				const adapted = options.configure({
					tool: turnTool,
					configuration: configurationLease.snapshot,
					turn: context,
				});
				assertConfiguredTool(baseTool.name, adapted);
				options.observationPublisher?.record(CODING_TOOL_CONFIGURATION_OBSERVATION, {
					operation: "bind",
					phase: "completed",
					toolName: baseTool.name,
					support: association.support,
					configurationCount: association.configurationIds.length,
				});
				return createBinding(adapted, configurationLease, toolBinding);
			} catch (error) {
				void releaseBindings(configurationLease, toolBinding).catch(() => undefined);
				observeFailure(options, baseTool.name, association, error);
				throw error;
			}
		},
	};

	return {
		...registration,
		tool: configuredTool,
		configuration: association,
	};
}

interface NormalizedAssociation extends CodingToolConfigurationAssociation {
	readonly requiredConfigurationIds: readonly string[];
}

function normalizeAssociation(
	association: CodingToolConfigurationAssociation,
	missingPolicy: CodingToolConfigurationMissingPolicy | undefined,
): NormalizedAssociation {
	if (!association || typeof association !== "object") {
		throw invalidBinding("Coding Tool configuration association must be an object");
	}
	if (association.support !== "native" && association.support !== "adapter" && association.support !== "host-policy") {
		throw invalidBinding("Coding Tool configuration support mode is invalid");
	}
	const configurationIds = normalizeIds(association.configurationIds, "configurationIds");
	const requiredConfigurationIds = normalizeIds(
		association.requiredConfigurationIds ?? [],
		"requiredConfigurationIds",
	);
	const configuredIds = new Set(configurationIds);
	if (requiredConfigurationIds.some((id) => !configuredIds.has(id))) {
		throw invalidBinding("Coding Tool required configuration ids must also appear in configurationIds");
	}
	if (requiredConfigurationIds.length > 0 && missingPolicy === undefined) {
		throw invalidBinding("Coding Tool with required configuration ids must declare onMissingConfiguration");
	}
	return Object.freeze({
		configurationIds: Object.freeze(configurationIds),
		requiredConfigurationIds: Object.freeze(requiredConfigurationIds),
		support: association.support,
	});
}

function normalizeIds(ids: readonly string[], label: string): string[] {
	if (!Array.isArray(ids)) throw invalidBinding(`Coding Tool ${label} must be an array`);
	const normalized = ids.map((id) => {
		if (typeof id !== "string" || id.trim() === "" || id !== id.trim()) {
			throw invalidBinding(`Coding Tool ${label} must contain non-empty trimmed strings`);
		}
		return id;
	});
	if (new Set(normalized).size !== normalized.length) {
		throw invalidBinding(`Coding Tool ${label} must not contain duplicates`);
	}
	return normalized;
}

function assertConfiguredTool<TInput extends object>(baseToolName: string, tool: RuntimeToolDefinition<TInput>): void {
	if (!tool || typeof tool !== "object" || typeof tool.execute !== "function") {
		throw invalidBinding(`Configured Coding Tool ${baseToolName} must be a Runtime Tool definition`);
	}
	if (tool.name !== baseToolName) {
		throw new CodingToolConfigurationError(
			CODING_TOOL_CONFIGURATION_ERROR_CODES.TOOL_NAME_CHANGED,
			`Configured Coding Tool changed its name: ${baseToolName} -> ${tool.name}`,
		);
	}
}

function createBinding<TInput extends object>(
	tool: RuntimeToolDefinition<TInput>,
	configurationLease: RuntimeConfigurationSnapshotLease,
	toolBinding: RuntimeToolTurnBinding<TInput> | undefined,
): RuntimeToolTurnBinding<TInput> {
	let released = false;
	return Object.freeze({
		tool,
		release: async () => {
			if (released) return;
			released = true;
			await releaseBindings(configurationLease, toolBinding);
		},
	});
}

async function releaseBindings<TInput extends object>(
	configurationLease: RuntimeConfigurationSnapshotLease,
	toolBinding: RuntimeToolTurnBinding<TInput> | undefined,
): Promise<void> {
	const results = await Promise.allSettled([toolBinding?.release(), configurationLease.release()]);
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map(({ reason }) => reason);
	if (errors.length > 0) throw new AggregateError(errors, "Failed to release configured Coding Tool bindings");
}

function observeFailure<TInput extends object>(
	options: CodingToolConfigurationAdapterOptions<TInput>,
	toolName: string,
	association: CodingToolConfigurationAssociation,
	error: unknown,
): void {
	options.observationPublisher?.record(CODING_TOOL_CONFIGURATION_ISSUE_OBSERVATION, {
		operation: "bind",
		phase: "failed",
		toolName,
		support: association.support,
		configurationCount: association.configurationIds.length,
		failure: runtimeObservationFailure(error),
	});
}

function invalidBinding(message: string): CodingToolConfigurationError {
	return new CodingToolConfigurationError(CODING_TOOL_CONFIGURATION_ERROR_CODES.INVALID_BINDING, message);
}
