/**
 * Prefire（后台预压缩）缓存与前缀指纹。
 *
 * 到达压缩阈值前 lead 个百分点时，后台先跑一次摘要并缓存；真正触发压缩时若
 * 会话前缀未变（指纹匹配）直接复用缓存，用户无感。触发时沿用 prefire 时的
 * 切点——被保留的尾巴比按当下重新切略大（差额受 lead 上限约束），换取压缩瞬时完成。
 *
 * 指纹 = 上一次 compaction 边界之后、firstKeptEntryId 之前全部 entry id 链的
 * FNV-1a 哈希。rewind / 分支切换 / 编辑历史都会改变 id 链 → 指纹天然失效，
 * 无需额外事件监听。缓存仅存内存（会话重载后重新预热）。
 */

import type { CompactionHistoryEntry, CompactionResult, CompactionSettings } from "./contracts.js";
import { getCompactThreshold } from "./token-policy.js";

/** 阈值前多少个百分点（相对 context window）开始 prefire：慢速会话的缺省值。 */
export const PREFIRE_LEAD_PERCENT = 10;

/** lead 自适应上限：预热窗口过大时被保留的尾巴相应变大（差额受 lead 约束），封顶 25%。 */
export const PREFIRE_LEAD_PERCENT_MAX = 25;

/** 触发自适应的增速门槛：单次模型调用增量超过窗口的 5% 才值得加宽预热窗口。 */
const ADAPTIVE_GROWTH_TRIGGER_PERCENT = 5;

/**
 * lead 自适应：按最近一次模型调用的上下文增量加宽预热窗口。
 *
 * 固定 10% 的失败模式：工具密集会话单轮可增数万 token，会话可能从「窗口外」
 * 一步跳到「阈值之上」——prefire 从未启动，后台预热的机会被整轮跳过。
 * 增速越快，越早开始预热；增速慢（或缺历史）维持缺省 10%。
 *
 * 规则：增量超过窗口 5%（门槛，避免小波动抖动）时，lead 提升到
 * 「增量占窗口百分比的 2 倍」（预留：预热本身要跑一轮，窗口需容得下
 * 再涨一轮），封顶 25%。无历史（growth 缺省/非正/窗口非法）返回缺省。
 */
export function computePrefireLeadPercent(growthTokens: number | undefined, contextWindow: number): number {
	if (growthTokens === undefined || !Number.isFinite(growthTokens) || growthTokens <= 0) return PREFIRE_LEAD_PERCENT;
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return PREFIRE_LEAD_PERCENT;
	const growthPercent = (growthTokens / contextWindow) * 100;
	if (growthPercent < ADAPTIVE_GROWTH_TRIGGER_PERCENT) return PREFIRE_LEAD_PERCENT;
	return Math.min(PREFIRE_LEAD_PERCENT_MAX, Math.max(PREFIRE_LEAD_PERCENT, Math.ceil(growthPercent * 2)));
}

export interface PrefireCache {
	fingerprint: string;
	result: CompactionResult;
}

/** FNV-1a 32-bit（与依赖无关的稳定哈希，输出 8 位 hex）。 */
function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 计算「将被摘要的前缀」的指纹。
 * @returns firstKeptEntryId 不在当前分支（或落在上一次 compaction 之前）时返回 undefined。
 */
export function fingerprintCompactionPrefix(
	pathEntries: readonly CompactionHistoryEntry[],
	firstKeptEntryId: string,
): string | undefined {
	let boundaryStart = 0;
	for (let i = pathEntries.length - 1; i >= 0; i--) {
		if (pathEntries[i].type === "compaction") {
			boundaryStart = i + 1;
			break;
		}
	}
	const keptIndex = pathEntries.findIndex((entry) => entry.id === firstKeptEntryId);
	if (keptIndex < boundaryStart) return undefined; // 含 -1（id 不在分支上）
	const ids: string[] = [];
	for (let i = boundaryStart; i < keptIndex; i++) {
		ids.push(pathEntries[i].id ?? "");
	}
	return fnv1a(`${ids.join("\n")}|${firstKeptEntryId}`);
}

/** 校验缓存对当前分支是否仍有效（前缀未变）。 */
export function isPrefireCacheValid(cache: PrefireCache, pathEntries: readonly CompactionHistoryEntry[]): boolean {
	if (pathEntries.length === 0) return false;
	// 已经以 compaction 收尾（刚压缩过）→ 缓存必然过期
	if (pathEntries[pathEntries.length - 1].type === "compaction") return false;
	return fingerprintCompactionPrefix(pathEntries, cache.result.firstKeptEntryId) === cache.fingerprint;
}

/**
 * 是否应启动 prefire：已越过「阈值 - lead」但尚未到阈值。
 * 到阈值后由正式压缩接管，prefire 不再启动。
 */
export function shouldPrefire(
	contextTokens: number,
	contextWindow: number,
	settings: CompactionSettings,
	leadPercent: number = PREFIRE_LEAD_PERCENT,
): boolean {
	if (contextWindow <= 0) return false;
	const threshold = getCompactThreshold(contextWindow, settings);
	const lead = Math.floor((contextWindow * leadPercent) / 100);
	return contextTokens >= threshold - lead && contextTokens < threshold;
}
