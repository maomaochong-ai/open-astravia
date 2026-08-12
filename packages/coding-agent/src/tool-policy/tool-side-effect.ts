import { DEFAULT_TOOL_SIDE_EFFECT, normalizeToolSideEffect, type ToolSideEffect } from "../profiles/index.js";

/**
 * 未显式声明 `side_effect` 时按工具名兜底判定为 heavy 的初始清单。
 *
 * 判定标准与 profiles/contracts.ts 的 ToolSideEffect 一致：在用户工作区创建目录/文件树、
 * 产生外部计费、发起不可撤销的外部动作。工具作者显式声明后以声明为准，此清单只是兜底，
 * 避免宿主解析链尚未透传声明时 heavy 工具被当成 light 直接执行。
 */
export const DEFAULT_HEAVY_TOOL_NAMES: readonly string[] = [
	// vetta-ui-design：在工作区落一整棵 .vetd 工程目录
	"vetd_create",
	"vetd_install",
	// image-gen：调用外部计费的图像模型
	"generate_image",
	"edit_image",
	// remotion-renderer：启动完整浏览器渲染管线并往工作区写 out/
	"render_remotion_video",
	// content-creation：往工作区写一棵内容工程文件树
	"content_creation_edit",
];

/**
 * 刻意不列入的近邻工具，避免后来者「补全」时把它们一并加进来：
 *
 * - `content_creation_run`：自带全局确认对话框，prepare 不消耗配额，真正启动必须由用户在该
 *   对话框内点击。再加一层闸只会变成双重确认。
 * - `content_creation_assets`：导入落在插件托管存储而非用户工作区，工具描述亦明确声明无需确认。
 * - `content_creation_inspect`：只读。
 */

export interface ToolSideEffectDeclaration {
	readonly name: string;
	/** 外部边界（插件 manifest / 贡献）声明的原始值，未收窄。 */
	readonly side_effect?: unknown;
	/** 宿主内部注册声明的值。 */
	readonly sideEffect?: ToolSideEffect;
}

export interface CodingAgentToolSideEffectResolverOptions {
	/** 实时读取当前可见的工具声明；插件贡献会在会话中变化，因此按需读取而不是快照。 */
	readonly readDeclarations: () => Iterable<ToolSideEffectDeclaration>;
	/** 覆盖兜底 heavy 清单，主要供测试使用。 */
	readonly defaultHeavyToolNames?: Iterable<string>;
}

export type CodingAgentToolSideEffectResolver = (toolName: string) => ToolSideEffect;

/** 解析单个工具的副作用等级：显式声明优先，其次兜底 heavy 清单，最后按 light 处理。 */
export function createCodingAgentToolSideEffectResolver(
	options: CodingAgentToolSideEffectResolverOptions,
): CodingAgentToolSideEffectResolver {
	const heavyByName = new Set(options.defaultHeavyToolNames ?? DEFAULT_HEAVY_TOOL_NAMES);
	return (toolName) => {
		for (const declaration of options.readDeclarations()) {
			if (declaration.name !== toolName) continue;
			const declared = declaration.sideEffect ?? normalizeToolSideEffect(declaration.side_effect);
			if (declared) return declared;
		}
		return heavyByName.has(toolName) ? "heavy" : DEFAULT_TOOL_SIDE_EFFECT;
	};
}
