export type CodingAgentResourceSourceRevision = string | number;

/** 内联 Skill 值贡献；内容由 Session 持有，不要求调用方创建临时文件。 */
export interface CodingAgentSkillContribution {
	readonly name: string;
	readonly alias?: string;
	readonly description: string;
	readonly content: string;
	readonly filePath?: string;
	readonly baseDir?: string;
	readonly type?: "skill" | "scene";
	readonly agentModes?: readonly string[];
	readonly disableModelInvocation?: boolean;
}

/** Skill 的声明式匹配条件；同一 selector 内不同字段取交集，字段值内部取并集。 */
export interface CodingAgentSkillSelector {
	readonly names?: readonly string[];
	readonly nameContains?: readonly string[];
	readonly sources?: readonly string[];
	readonly types?: readonly ("skill" | "scene")[];
}

/** 先应用 include，再应用 exclude；避免把任意资源覆盖回调暴露给稳定 SDK。 */
export interface CodingAgentSkillPolicy {
	readonly include?: CodingAgentSkillSelector;
	readonly exclude?: CodingAgentSkillSelector;
}

export interface CodingAgentSkillSourceSnapshot {
	readonly revision: CodingAgentResourceSourceRevision;
	readonly paths?: readonly string[];
	readonly skills?: readonly CodingAgentSkillContribution[];
	readonly policy?: CodingAgentSkillPolicy;
}

export interface CodingAgentExtensionSourceSnapshot {
	readonly revision: CodingAgentResourceSourceRevision;
	readonly paths: readonly string[];
}

export type CodingAgentResourceSourceInvalidationListener = () => void;

/**
 * Session 拥有的动态 Skill 来源。
 *
 * `subscribe` 只报告失效，不直接替换当前 Turn 的能力；下一次普通 prompt 或显式 reload 时读取新 revision。
 */
export interface CodingAgentSkillSource {
	readonly id: string;
	read(signal?: AbortSignal): CodingAgentSkillSourceSnapshot | Promise<CodingAgentSkillSourceSnapshot>;
	subscribe?(listener: CodingAgentResourceSourceInvalidationListener): () => void;
	dispose?(): void | Promise<void>;
}

/** Session 拥有的动态 Extension 路径来源；Extension 代码仍由产品 Host Loader 解析和执行。 */
export interface CodingAgentExtensionSource {
	readonly id: string;
	read(signal?: AbortSignal): CodingAgentExtensionSourceSnapshot | Promise<CodingAgentExtensionSourceSnapshot>;
	subscribe?(listener: CodingAgentResourceSourceInvalidationListener): () => void;
	dispose?(): void | Promise<void>;
}
