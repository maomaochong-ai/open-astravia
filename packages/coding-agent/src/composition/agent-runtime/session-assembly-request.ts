import type {
	RuntimeAgentSessionDefinition,
	RuntimeAgentSessionPreparationContext,
	RuntimeResources,
} from "@vetta/runtime-core";
import type { CodingAgentCapabilitySessionBinding } from "../session-lifecycle/resource-lifecycle.js";

export interface CodingAgentPreparedRuntimeAgentSession {
	readonly definition: RuntimeAgentSessionDefinition;
	activate(binding: CodingAgentCapabilitySessionBinding): Promise<RuntimeResources>;
	fail(): void;
	dispose(): Promise<void>;
}

type PrepareCodingAgentRuntimeSession = (
	context: RuntimeAgentSessionPreparationContext,
) => Promise<CodingAgentPreparedRuntimeAgentSession>;

const sessionAssemblyRequests = new WeakSet<object>();

/**
 * RuntimeAgentDefinition 与 Coding Agent 产品 Session 装配之间的一次性交接对象。
 * 它不穿过序列化边界，也不允许同一个产品资源图被 revision rollout 重复消费。
 */
export class CodingAgentRuntimeAgentSessionAssemblyRequest {
	private prepared?: CodingAgentPreparedRuntimeAgentSession;
	private preparing = false;
	private consumed = false;

	constructor(private readonly prepareSession: PrepareCodingAgentRuntimeSession) {
		sessionAssemblyRequests.add(this);
	}

	async prepare(context: RuntimeAgentSessionPreparationContext): Promise<RuntimeAgentSessionDefinition> {
		if (this.preparing || this.prepared || this.consumed) {
			throw new Error("Coding Agent Runtime session assembly request has already been used");
		}
		this.preparing = true;
		try {
			const prepared = await this.prepareSession(context);
			this.prepared = prepared;
			return prepared.definition;
		} finally {
			this.preparing = false;
		}
	}

	consume(): CodingAgentPreparedRuntimeAgentSession {
		if (this.consumed) throw new Error("Coding Agent Runtime session assembly request has already been consumed");
		if (!this.prepared) throw new Error("Coding Agent Runtime session assembly request was not prepared");
		this.consumed = true;
		return this.prepared;
	}

	async rollback(): Promise<void> {
		if (this.consumed || !this.prepared) return;
		this.consumed = true;
		this.prepared.fail();
		await this.prepared.dispose();
	}
}

export function requireCodingAgentRuntimeSessionAssemblyRequest(
	configuration: unknown,
): CodingAgentRuntimeAgentSessionAssemblyRequest {
	if (!configuration || typeof configuration !== "object" || !sessionAssemblyRequests.has(configuration)) {
		throw new Error("Coding Agent Runtime requires an internal session assembly request");
	}
	return configuration as CodingAgentRuntimeAgentSessionAssemblyRequest;
}
