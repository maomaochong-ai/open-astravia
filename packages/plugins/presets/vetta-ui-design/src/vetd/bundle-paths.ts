/**
 * 设计包内相对路径的影响面判定：一次改动波及某一帧、全部帧，还是谁都不波及。
 *
 * 唯一事实源。两个消费方问的是同一个问题、必须得到同一个答案：
 * - 画布的位图刷新（DesignCanvas）：源码变了要重截哪些 frame。
 * - 活动态浮层（design-runtime）：agent 在改什么，画布上该点亮哪些 frame。
 */
import { isFrameFile } from "../../engine/src/routes";
import { MANIFEST_FILE } from "./manifest-types";

/**
 * 不参与渲染的东西。`.notes.json` 是备注数据、`design.json` 是画布 manifest
 * （拖一下画框就重写一次）：两者都不影响任何 frame 的渲染，算进来的话每写一条
 * 备注、每拖一次画框就要全画布重截图。
 */
export const GENERATED_PREFIXES = [".snapshots/", ".vetd-build/", "node_modules/", ".notes.json", MANIFEST_FILE];

/** 一次源码改动影响到谁。 */
export type SourceImpact = { kind: "frame"; frameId: string } | { kind: "shared" } | { kind: "none" };

const SHARED: SourceImpact = { kind: "shared" };
const NONE: SourceImpact = { kind: "none" };

/** 目录名判定要用 `xxx/` 前缀，这里统一成正斜杠，Windows 上的反斜杠先抹平。 */
export function normalizeRelative(relative: string): string {
	return relative.replaceAll("\\", "/");
}

export function isGeneratedPath(relative: string): boolean {
	const rel = normalizeRelative(relative);
	// 文档只写给人和模型看，改它不会让任何一帧长得不一样。
	if (rel.endsWith(".md")) return true;
	return GENERATED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * `frames/<id>.tsx` 只影响它自己；`theme.css`、`components/*`、`assets/*`、
 * `frames/_layout.tsx` 这类共享件改一下可能影响任意一帧——依赖关系无从判断，
 * 只能算全部。
 */
export function classifySource(relative: string): SourceImpact {
	const rel = normalizeRelative(relative);
	if (isGeneratedPath(rel)) return NONE;
	const rest = rel.startsWith("frames/") ? rel.slice("frames/".length) : null;
	// 嵌套文件不是画框：reconcile 只扫 `frames/` 平铺的这一层。
	if (rest === null || rest.includes("/") || !rest.endsWith(".tsx")) return SHARED;
	if (!isFrameFile(rest)) return SHARED;
	return { kind: "frame", frameId: rest.slice(0, -".tsx".length) };
}
