import type {
	CapabilityBinding,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
	RuntimeToolResult,
} from "@vetta/runtime-core/kernel";
import { CODING_TOOL_AVAILABILITY_ERROR_CODES, CodingToolAvailabilityError } from "./coding-tool-availability.js";
import { CodingToolExecutionTracker } from "./coding-tool-execution-tracker.js";
import { type CodingToolResultPolicy, PRESERVE_CODING_TOOL_RESULT_POLICY } from "./coding-tool-result-policy.js";
import type { CodingToolRegistration } from "./tool-registration.js";

export type CodingToolAvailabilityState = "active" | "deactivated" | "revoked";

export interface CodingToolCatalogEntry {
	readonly binding: CapabilityBinding;
	readonly registration: CodingToolRegistration;
	readonly state: CodingToolAvailabilityState;
}

export interface CodingToolCatalogSnapshot {
	readonly version: number;
	readonly entries: readonly CodingToolCatalogEntry[];
	readonly registrations: readonly CodingToolRegistration[];
}

export interface CodingToolCatalog {
	snapshot(): CodingToolCatalogSnapshot;
	resolve(toolName: string): CodingToolCatalogEntry | undefined;
	execute(binding: CapabilityBinding, request: RuntimeToolExecutionRequest): Promise<RuntimeToolResult>;
}

export interface CodingToolRevokeOptions {
	readonly reason?: string;
}

export interface CodingToolRegistry extends CodingToolCatalog {
	register(registration: CodingToolRegistration): void;
	activate(toolName: string): boolean;
	deactivate(toolName: string): boolean;
	revoke(toolName: string, options?: CodingToolRevokeOptions): boolean;
	unregister(toolName: string): boolean;
}

export interface InMemoryCodingToolRegistryOptions {
	readonly sourceId?: string;
	readonly resultPolicy?: CodingToolResultPolicy;
}

export class InMemoryCodingToolRegistry implements CodingToolRegistry {
	private readonly entriesByName = new Map<string, CodingToolCatalogEntry>();
	private readonly executionTracker = new CodingToolExecutionTracker();
	private readonly sourceId: string;
	private readonly resultPolicy: CodingToolResultPolicy;
	private version = 0;
	private nextRevision = 0;
	private cachedSnapshot: CodingToolCatalogSnapshot | undefined;

	constructor(
		initialRegistrations: readonly CodingToolRegistration[] = [],
		options: InMemoryCodingToolRegistryOptions = {},
	) {
		this.sourceId = options.sourceId ?? "coding-tools";
		this.resultPolicy = options.resultPolicy ?? PRESERVE_CODING_TOOL_RESULT_POLICY;
		for (const registration of initialRegistrations) {
			this.addInitialRegistration(registration);
		}
	}

	register(registration: CodingToolRegistration): void {
		this.assertAvailable(registration.tool.name);
		this.entriesByName.set(registration.tool.name, this.createEntry(registration));
		this.markChanged();
	}

	activate(toolName: string): boolean {
		const current = this.entriesByName.get(toolName);
		if (!current || current.state === "active") return false;
		this.entriesByName.set(toolName, freezeEntry({ ...current, state: "active" }));
		this.markChanged();
		return true;
	}

	deactivate(toolName: string): boolean {
		const current = this.entriesByName.get(toolName);
		if (!current || current.state !== "active") return false;
		this.entriesByName.set(toolName, freezeEntry({ ...current, state: "deactivated" }));
		this.markChanged();
		return true;
	}

	revoke(toolName: string, options: CodingToolRevokeOptions = {}): boolean {
		const current = this.entriesByName.get(toolName);
		if (!current || current.state === "revoked") return false;
		const binding = this.createBinding(toolName);
		this.entriesByName.set(toolName, freezeEntry({ ...current, binding, state: "revoked" }));
		this.markChanged();
		this.executionTracker.revoke(toolName, options.reason ?? `Coding tool revoked: ${toolName}`);
		return true;
	}

	unregister(toolName: string): boolean {
		if (!this.entriesByName.delete(toolName)) {
			return false;
		}
		this.markChanged();
		return true;
	}

	snapshot(): CodingToolCatalogSnapshot {
		if (this.cachedSnapshot) {
			return this.cachedSnapshot;
		}
		const entries = [...this.entriesByName.values()].filter(({ state }) => state === "active").sort(compareEntryName);
		this.cachedSnapshot = Object.freeze({
			version: this.version,
			entries: Object.freeze(entries),
			registrations: Object.freeze(entries.map(({ registration }) => registration)),
		});
		return this.cachedSnapshot;
	}

	resolve(toolName: string): CodingToolCatalogEntry | undefined {
		return this.entriesByName.get(toolName);
	}

	async execute(binding: CapabilityBinding, request: RuntimeToolExecutionRequest): Promise<RuntimeToolResult> {
		const current = this.entriesByName.get(binding.capabilityId);
		this.assertExecutable(current, binding);
		return this.executionTracker.run(
			binding.capabilityId,
			request.signal,
			async (signal) => {
				const result = await current.registration.tool.execute({ ...request, signal });
				return this.resultPolicy.project(result, {
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId: request.toolCallId,
					toolName: current.registration.tool.name,
					category: current.registration.category,
				});
			},
			() => this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED, binding),
		);
	}

	private addInitialRegistration(registration: CodingToolRegistration): void {
		this.assertAvailable(registration.tool.name);
		this.entriesByName.set(registration.tool.name, this.createEntry(registration));
	}

	private createEntry(registration: CodingToolRegistration): CodingToolCatalogEntry {
		const frozenRegistration = freezeRegistration(registration);
		return freezeEntry({
			binding: this.createBinding(frozenRegistration.tool.name),
			registration: frozenRegistration,
			state: "active",
		});
	}

	private createBinding(toolName: string): CapabilityBinding {
		this.nextRevision += 1;
		return Object.freeze({
			sourceId: this.sourceId,
			capabilityId: toolName,
			revision: String(this.nextRevision),
		});
	}

	private assertExecutable(
		current: CodingToolCatalogEntry | undefined,
		advertisedBinding: CapabilityBinding,
	): asserts current is CodingToolCatalogEntry {
		if (!current) {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE, advertisedBinding);
		}
		if (current.state === "deactivated") {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.DEACTIVATED, advertisedBinding);
		}
		if (current.state === "revoked") {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED, advertisedBinding);
		}
		if (!sameBinding(current.binding, advertisedBinding)) {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.DEFINITION_CHANGED, advertisedBinding);
		}
	}

	private availabilityError(
		code: (typeof CODING_TOOL_AVAILABILITY_ERROR_CODES)[keyof typeof CODING_TOOL_AVAILABILITY_ERROR_CODES],
		binding: CapabilityBinding,
	): CodingToolAvailabilityError {
		return new CodingToolAvailabilityError(code, binding);
	}

	private assertAvailable(toolName: string): void {
		if (this.entriesByName.has(toolName)) {
			throw new Error(`Duplicate coding tool registration: ${toolName}`);
		}
	}

	private markChanged(): void {
		this.version += 1;
		this.cachedSnapshot = undefined;
	}
}

function freezeEntry(entry: CodingToolCatalogEntry): CodingToolCatalogEntry {
	return Object.freeze(entry);
}

function freezeRegistration(registration: CodingToolRegistration): CodingToolRegistration {
	return Object.freeze({
		tool: freezeToolDefinition(registration.tool),
		scopeUse: Object.freeze([...registration.scopeUse]),
		requires: registration.requires ? Object.freeze([...registration.requires]) : undefined,
		agentModes: registration.agentModes ? Object.freeze([...registration.agentModes]) : undefined,
		modelOrder: registration.modelOrder,
		category: registration.category,
	});
}

function freezeToolDefinition(tool: RuntimeToolDefinition): RuntimeToolDefinition {
	return Object.freeze({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		inputSchema: tool.inputSchema,
		modelOrder: tool.modelOrder,
		execute: (request: RuntimeToolExecutionRequest) => tool.execute(request),
	});
}

function sameBinding(left: CapabilityBinding, right: CapabilityBinding): boolean {
	return (
		left.sourceId === right.sourceId && left.capabilityId === right.capabilityId && left.revision === right.revision
	);
}

function compareEntryName(left: CodingToolCatalogEntry, right: CodingToolCatalogEntry): number {
	if (left.binding.capabilityId < right.binding.capabilityId) return -1;
	if (left.binding.capabilityId > right.binding.capabilityId) return 1;
	return 0;
}
