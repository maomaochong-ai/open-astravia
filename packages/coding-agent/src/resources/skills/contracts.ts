import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";

export interface SkillFrontmatter {
	name?: string;
	alias?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	hooks?: unknown;
	metadata?: { type?: string; [key: string]: unknown };
	[key: string]: unknown;
}

export type SkillType = "skill" | "scene";

/** Skill 的结构化来源事实；与目录/安装来源正交。 */
export type SkillProvenance =
	| { readonly kind: "native"; readonly scope: string }
	| { readonly kind: "provided"; readonly providerType: "plugin" | "sdk" | "runtime"; readonly providerId: string }
	| { readonly kind: "builtin"; readonly providerId: string };

/** Fully materialized resource generation. Consumers never read the backing file. */
export interface Skill {
	readonly name: string;
	readonly alias?: string;
	readonly description: string;
	readonly filePath: string;
	readonly baseDir: string;
	readonly source: string;
	readonly provenance?: SkillProvenance;
	readonly type: SkillType;
	readonly disableModelInvocation: boolean;
	readonly content: string;
	readonly sceneTasks: readonly string[];
}

export interface LoadSkillsResult {
	readonly skills: Skill[];
	readonly diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsFromDirOptions {
	readonly resourceAccess: ResourceAccessPort;
	readonly dir: string;
	readonly source: string;
	readonly signal?: AbortSignal;
}

export interface LoadSkillsOptions {
	readonly resourceAccess: ResourceAccessPort;
	readonly cwd: string;
	readonly agentDir?: string;
	readonly sceneDir?: string;
	readonly skillPaths?: readonly string[];
	readonly includeDefaults?: boolean;
	readonly includeAgentSkills?: boolean;
	readonly signal?: AbortSignal;
}
