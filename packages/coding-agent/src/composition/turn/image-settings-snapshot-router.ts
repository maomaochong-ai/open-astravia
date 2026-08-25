import type {
	RuntimeConfigurationSnapshotAcquireContext,
	RuntimeConfigurationSnapshotLease,
	RuntimeConfigurationSnapshotSource,
} from "@vetta/runtime-core/configuration";
import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";
import { CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION } from "../../model-context/image-settings-observations.js";

/** Composition 级路由只解析 Session ownership；配置 generation 仍由各 Session 的 Runtime Core Center 持有。 */
export class CodingAgentImageSettingsSnapshotRouter implements RuntimeConfigurationSnapshotSource {
	private readonly sources = new Map<string, RuntimeConfigurationSnapshotSource>();

	constructor(private readonly observations?: RuntimeObservationPublisher) {}

	register(scopeId: string, source: RuntimeConfigurationSnapshotSource): void {
		const normalized = normalizeScopeId(scopeId);
		if (this.sources.has(normalized)) {
			this.observe("scope-conflict", normalized);
			throw new Error(`Coding Agent image configuration scope is already registered: ${normalized}`);
		}
		this.sources.set(normalized, source);
	}

	rebind(previousScopeId: string, nextScopeId: string, source: RuntimeConfigurationSnapshotSource): void {
		const previous = normalizeScopeId(previousScopeId);
		const next = normalizeScopeId(nextScopeId);
		if (previous === next) return;
		const current = this.sources.get(previous);
		if (current !== source) throw new Error(`Coding Agent image configuration scope is not owned: ${previous}`);
		if (this.sources.has(next)) {
			this.observe("scope-conflict", next);
			throw new Error(`Coding Agent image configuration scope is already registered: ${next}`);
		}
		this.sources.delete(previous);
		this.sources.set(next, source);
	}

	unregister(scopeId: string, source: RuntimeConfigurationSnapshotSource): void {
		const normalized = normalizeScopeId(scopeId);
		if (this.sources.get(normalized) === source) this.sources.delete(normalized);
	}

	acquire(context?: RuntimeConfigurationSnapshotAcquireContext): RuntimeConfigurationSnapshotLease {
		const scopeId = context?.scopeId;
		const source = scopeId ? this.sources.get(scopeId) : undefined;
		if (!scopeId || !source) {
			this.observe("scope-unavailable", scopeId);
			throw new Error("Coding Agent image configuration scope is unavailable");
		}
		return source.acquire(context);
	}

	private observe(code: "scope-conflict" | "scope-unavailable", scopeId?: string): void {
		this.observations?.record(
			CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION,
			{ operation: "snapshot.route", code },
			scopeId ? { sessionId: scopeId } : undefined,
		);
	}
}

function normalizeScopeId(value: string): string {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw new Error("Coding Agent image configuration scope id must be a non-empty trimmed string");
	}
	return value;
}
