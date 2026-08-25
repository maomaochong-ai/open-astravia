import type { BrowserGuardBlockCode } from "../guard/policy";

/**
 * 浏览器动作流水，用于事后审计「Agent 到底点了什么、什么被拦了」。
 *
 * 只保留在内存里、只保留尾部若干条：这是排查用的现场，不是需要跨重启保留的业务数据，
 * 落盘只会多出一份需要清理和脱敏的用户轨迹。
 */

export interface BrowserActivityEntry {
	id: number;
	timestamp: number;
	/** agent-browser 的原始工具名，例如 agent_browser_open。 */
	tool: string;
	/** 有 URL 参数时记录目标地址，便于回看导航路径。 */
	target?: string;
	outcome: "allowed" | "blocked";
	blockCode?: BrowserGuardBlockCode;
	reason?: string;
}

const MAX_ENTRIES = 200;

export class BrowserActivityLog {
	private entries: BrowserActivityEntry[] = [];
	private nextId = 1;
	private readonly listeners = new Set<(entries: readonly BrowserActivityEntry[]) => void>();

	list(): readonly BrowserActivityEntry[] {
		return this.entries;
	}

	subscribe(listener: (entries: readonly BrowserActivityEntry[]) => void): () => void {
		this.listeners.add(listener);
		listener(this.entries);
		return () => this.listeners.delete(listener);
	}

	record(entry: Omit<BrowserActivityEntry, "id" | "timestamp">, now = Date.now()): void {
		// 新的在前：面板永远关心最近发生了什么，倒序省掉一次渲染期 reverse。
		this.entries = [{ ...entry, id: this.nextId++, timestamp: now }, ...this.entries].slice(0, MAX_ENTRIES);
		for (const listener of this.listeners) listener(this.entries);
	}

	clear(): void {
		this.entries = [];
		for (const listener of this.listeners) listener(this.entries);
	}

	dispose(): void {
		this.listeners.clear();
		this.entries = [];
	}
}
