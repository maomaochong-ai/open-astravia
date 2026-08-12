import type {
	CapabilityBinding,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
	RuntimeToolExecutionRequest,
	RuntimeToolResult,
	RuntimeToolTurnBinding,
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

export interface CodingToolCatalogSnapshotLease {
	readonly snapshot: CodingToolCatalogSnapshot;
	release(): Promise<void>;
}

export interface CodingToolCatalog {
	snapshot(): CodingToolCatalogSnapshot;
	acquireSnapshot(context?: RuntimeSnapshotAcquireContext): CodingToolCatalogSnapshotLease;
	resolve(toolName: string): CodingToolCatalogEntry | undefined;
	execute(
		binding: CapabilityBinding,
		request: RuntimeToolExecutionRequest,
		implementation?: RuntimeToolDefinition,
	): Promise<RuntimeToolResult>;
}

export interface CodingToolRevokeOptions {
	readonly reason: string;
	readonly auditId: string;
}

export interface CodingToolRegistry extends CodingToolCatalog {
	register(registration: CodingToolRegistration): void;
	activate(toolName: string): boolean;
	deactivate(toolName: string): boolean;
	revoke(toolName: string, options: CodingToolRevokeOptions): boolean;
	unregister(toolName: string): boolean;
}

export interface InMemoryCodingToolRegistryOptions {
	readonly sourceId?: string;
	readonly resultPolicy?: CodingToolResultPolicy;
}

export class InMemoryCodingToolRegistry implements CodingToolRegistry {
	private readonly entriesByName = new Map<string, CodingToolCatalogEntry>();
	private readonly entriesByBinding = new Map<string, CodingToolCatalogEntry>();
	private readonly revokedBindings = new Set<string>();
	private readonly bindingLeaseCounts = new Map<string, number>();
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
		if (!current || current.state === "active" || current.state === "revoked") return false;
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

	revoke(toolName: string, options: CodingToolRevokeOptions): boolean {
		const current = this.entriesByName.get(toolName);
		if (!current || current.state === "revoked") return false;
		this.revokedBindings.add(bindingKey(current.binding));
		const binding = this.createBinding(toolName);
		this.entriesByName.set(toolName, freezeEntry({ ...current, binding, state: "revoked" }));
		this.pruneRetiredBinding(current.binding);
		this.markChanged();
		this.executionTracker.revoke(toolName, `${options.reason} [auditId=${options.auditId}]`);
		return true;
	}

	unregister(toolName: string): boolean {
		const current = this.entriesByName.get(toolName);
		if (!current || !this.entriesByName.delete(toolName)) {
			return false;
		}
		this.pruneRetiredBinding(current.binding);
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

	acquireSnapshot(context?: RuntimeSnapshotAcquireContext): CodingToolCatalogSnapshotLease {
		const sourceSnapshot = this.snapshot();
		const toolBindings: RuntimeToolTurnBinding[] = [];
		let snapshot = sourceSnapshot;
		try {
			if (context) {
				const entries = sourceSnapshot.entries.map((entry) => {
					const binding = entry.registration.tool.bindForTurn?.(context);
					if (!binding) return entry;
					if (binding.tool.name !== entry.registration.tool.name) {
						throw new Error(`Turn-bound coding tool changed its name: ${entry.registration.tool.name}`);
					}
					toolBindings.push(binding);
					return freezeEntry({
						...entry,
						registration: freezeRegistration({ ...entry.registration, tool: binding.tool }),
					});
				});
				snapshot = Object.freeze({
					version: sourceSnapshot.version,
					entries: Object.freeze(entries),
					registrations: Object.freeze(entries.map(({ registration }) => registration)),
				});
			}
		} catch (error) {
			for (const binding of toolBindings.reverse()) void binding.release();
			throw error;
		}
		const keys = snapshot.entries.map(({ binding }) => bindingKey(binding));
		for (const key of keys) this.bindingLeaseCounts.set(key, (this.bindingLeaseCounts.get(key) ?? 0) + 1);
		let released = false;
		return {
			snapshot,
			release: async () => {
				if (released) return;
				released = true;
				for (const entry of snapshot.entries) {
					const key = bindingKey(entry.binding);
					const next = (this.bindingLeaseCounts.get(key) ?? 1) - 1;
					if (next > 0) this.bindingLeaseCounts.set(key, next);
					else this.bindingLeaseCounts.delete(key);
					this.pruneRetiredBinding(entry.binding);
				}
				const results = await Promise.allSettled(toolBindings.map((binding) => binding.release()));
				const errors = results
					.filter((result): result is PromiseRejectedResult => result.status === "rejected")
					.map(({ reason }) => reason);
				if (errors.length > 0) throw new AggregateError(errors, "Failed to release Turn-bound coding tools");
			},
		};
	}

	resolve(toolName: string): CodingToolCatalogEntry | undefined {
		return this.entriesByName.get(toolName);
	}

	async execute(
		binding: CapabilityBinding,
		request: RuntimeToolExecutionRequest,
		implementation?: RuntimeToolDefinition,
	): Promise<RuntimeToolResult> {
		const advertised = this.entriesByBinding.get(bindingKey(binding));
		if (!advertised) {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE, binding);
		}
		if (this.revokedBindings.has(bindingKey(binding))) {
			throw this.availabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED, binding);
		}
		return this.executionTracker.run(
			binding.capabilityId,
			request.signal,
			async (signal) => {
				const tool = implementation ?? advertised.registration.tool;
				const result = await tool.execute({ ...request, signal });
				return this.resultPolicy.project(result, {
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId: request.toolCallId,
					toolName: advertised.registration.tool.name,
					category: advertised.registration.category,
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
		const entry = freezeEntry({
			binding: this.createBinding(frozenRegistration.tool.name),
			registration: frozenRegistration,
			state: "active",
		});
		this.entriesByBinding.set(bindingKey(entry.binding), entry);
		return entry;
	}

	private createBinding(toolName: string): CapabilityBinding {
		this.nextRevision += 1;
		return Object.freeze({
			sourceId: this.sourceId,
			capabilityId: toolName,
			revision: String(this.nextRevision),
		});
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

	private pruneRetiredBinding(binding: CapabilityBinding): void {
		const key = bindingKey(binding);
		if (this.bindingLeaseCounts.has(key)) return;
		if ([...this.entriesByName.values()].some((entry) => bindingKey(entry.binding) === key)) return;
		this.entriesByBinding.delete(key);
		this.revokedBindings.delete(key);
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
		validateInput: tool.validateInput,
		contextSource: tool.contextSource,
		contextCategory: tool.contextCategory,
		modelOrder: tool.modelOrder,
		bindForTurn: tool.bindForTurn,
		execute: (request: RuntimeToolExecutionRequest) => tool.execute(request),
	});
}

function bindingKey(binding: CapabilityBinding): string {
	return `${binding.sourceId}\u0000${binding.capabilityId}\u0000${binding.revision}`;
}

function compareEntryName(left: CodingToolCatalogEntry, right: CodingToolCatalogEntry): number {
	if (left.binding.capabilityId < right.binding.capabilityId) return -1;
	if (left.binding.capabilityId > right.binding.capabilityId) return 1;
	return 0;
}
