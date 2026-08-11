import { applyDesignSystem } from "../design-systems/apply";
import type { DesignSystem } from "../design-systems/types";
import { getPluginCtx } from "../plugin-context";
import { scaffoldDesign } from "../vetd/scaffold";
import { createDesignProject } from "./gallery-actions";
import { DESIGN_SKILL_DRAFT } from "./open-project";

/**
 * 从一套设计体系开一份新设计（侧边栏「设计」页的风格库入口）。
 *
 * 和「新建空白」的区别只在于：这里预先铺好 `.vetd` 并把体系应用上去（零 frame 时
 * `applyDesignSystem` 走 direct 模式，theme.css 与 DESIGN.md 直写，不经模型转写）。
 *
 * 铺 `.vetd` 是对 `createDesignProject` 那条「刻意不预铺」约定的**有依据的例外**：那条
 * 约定针对的是「结构未知的空设计」，而这里用户已经用一次点击表达了风格意图，落盘的
 * 也不是空壳，而是一份已经带主题与规范的起点。屏数与尺寸仍由第一句提示词决定，所以
 * 之后照旧进新会话、不强行铺开还没有画框的画布。
 */

export interface StartedFromSystem {
	cwd: string;
	vetdPath: string;
}

/** 项目名：直接用体系名，清洗交给 createDesignProject 里的 toProjectName。 */
export function designNameForSystem(system: DesignSystem): string {
	return system.name;
}

/**
 * 进会话时预置的输入框草稿：带上 skill badge 和已应用的体系，用户接着敲要做什么就行。
 * 与 buildRestylePrompt 同一取舍——协议串跟宿主 locale 走，不进 locales catalog。
 */
export function buildStyleStartDraft(system: DesignSystem, locale: string): string {
	if (locale.toLowerCase().startsWith("zh")) {
		return `${DESIGN_SKILL_DRAFT}这份设计已经应用「${system.name}」体系（规范见 DESIGN.md）。我想做：`;
	}
	return `${DESIGN_SKILL_DRAFT}This design already uses the "${system.name}" system (see DESIGN.md). I want to build: `;
}

export async function startDesignFromSystem(system: DesignSystem, locale: string): Promise<StartedFromSystem> {
	const ctx = getPluginCtx();
	const { cwd } = await createDesignProject(designNameForSystem(system));
	const { vetdPath } = await scaffoldDesign(ctx.fs, cwd, designNameForSystem(system));
	await applyDesignSystem(ctx.fs, vetdPath, system.id);
	await ctx.official.navigation.open({
		target: "new-session",
		cwd,
		draft: buildStyleStartDraft(system, locale),
	});
	return { cwd, vetdPath };
}
