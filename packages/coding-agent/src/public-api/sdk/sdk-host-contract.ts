import type { CreateCodingAgentSessionOptions, CreateCodingAgentSessionResult } from "./sdk-create-contract.js";

/**
 * Host 级 Session 默认值。
 *
 * Storage 和动态 Source 具有独立 Session 所有权，必须在每次创建时显式提供，不能被多个 Session 共享。
 */
export type CodingAgentHostSessionDefaults = Omit<
	CreateCodingAgentSessionOptions,
	"extensionSources" | "skillSources" | "storage"
>;

export interface CreateCodingAgentHostOptions {
	/** 与单次 Session 参数进行浅合并；单次参数优先。 */
	readonly sessionDefaults?: CodingAgentHostSessionDefaults;
}

/** 拥有其创建的活动 Session，但不暴露具体产品管理器。 */
export interface CodingAgentHost {
	createSession(options?: CreateCodingAgentSessionOptions): Promise<CreateCodingAgentSessionResult>;
	close(): Promise<void>;
}
