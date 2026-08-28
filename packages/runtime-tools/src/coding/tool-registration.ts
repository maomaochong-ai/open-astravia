import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingToolResultPolicy } from "./coding-tool-result-policy.js";

export type CodingToolConfigurationSupport = "native" | "adapter" | "host-policy";

/** Tool 与通用 Runtime Configuration Definition 的可选关联，不进入模型 schema。 */
export interface CodingToolConfigurationAssociation {
	readonly configurationIds: readonly string[];
	readonly requiredConfigurationIds?: readonly string[];
	readonly support: CodingToolConfigurationSupport;
}

/** Runtime 只保存工具执行绑定与基础设施扩展，不承载上层场景或产品策略。 */
export interface CodingToolRegistration<TInput extends object = Readonly<Record<string, unknown>>> {
	readonly tool: RuntimeToolDefinition<TInput>;
	/** 最终模型工具数组中的稳定顺序；未声明的动态工具保持贡献顺序并排在其后。 */
	readonly modelOrder?: number;
	/** 配置行为由 Turn-bound Adapter 负责；这里只声明发现和关联元数据。 */
	readonly configuration?: CodingToolConfigurationAssociation;
	/** 单工具结果投影扩展；未声明时使用 Catalog 默认策略。 */
	readonly resultPolicy?: CodingToolResultPolicy;
}
