import type { CodingAgentPromptResourceResolver } from "../runtime-contracts/prompt-runtime.js";
import type { SessionResourceRuntime } from "./contracts/resource-runtime.js";
import {
	expandPromptResourceReference,
	type PromptResourceExpansionDependencies,
	type SceneTodoState,
} from "./prompt-resources/index.js";

export interface CodingAgentPromptResourceResolverOptions {
	readonly resourceLoader: Pick<SessionResourceRuntime, "getSkills" | "refreshSkillsIfChanged">;
	readonly todoState: SceneTodoState;
	readonly emitError?: PromptResourceExpansionDependencies["emitError"];
}

/**
 * 将会话自己的 ResourceLoader / TodoStore 接到 Runtime Prompt 边界。
 *
 * 每次解析前刷新资源指纹，因此新增、修改或删除 Skill/Scene 只影响后续 Prompt，
 * 已进入执行中的 Turn 仍使用其已经准备好的输入。
 */
export function createCodingAgentPromptResourceResolver(
	options: CodingAgentPromptResourceResolverOptions,
): CodingAgentPromptResourceResolver {
	return (text, promptRef) => {
		options.resourceLoader.refreshSkillsIfChanged();
		return expandPromptResourceReference(text, promptRef, {
			resourceLoader: options.resourceLoader,
			todoState: options.todoState,
			emitError: options.emitError,
		});
	};
}
