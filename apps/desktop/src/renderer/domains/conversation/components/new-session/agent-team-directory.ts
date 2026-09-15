import { useLocalizedAgentTeamDocument } from "@shared/agent-teams/agent-team-localization";
import type { AgentTeamDocument } from "@vetta/agent-team";
import { useEffect, useState } from "react";

/**
 * 新会话页的 Agent Team 名录（模块级缓存）。
 *
 * 同一屏有两个消费者：选择器（列出团队与智能体）和 hero 身份。两者各自拉一次
 * 就会在进页面时打两趟 IPC，而且可能拿到不同 revision 的文档、显示不一致的名字。
 * 这里合并同一时刻的请求并缓存最后一次结果，让后挂载的消费者先用缓存立即出内容。
 */
let cached: AgentTeamDocument | undefined;
let inflight: Promise<AgentTeamDocument> | undefined;
const listeners = new Set<() => void>();
/** 主进程侧「配置已变」的订阅，整个模块共一份。 */
let unsubscribeChanged: (() => void) | undefined;

/**
 * 跟随主进程的配置变更刷新缓存。
 *
 * 插件装卸与热重载会重铺插件贡献的智能体与团队，而这份缓存活到页面卸载之前都不会过期——不听
 * 这条事件，新会话页会一直摆着上一版的阵容。
 */
function watchAgentTeamDocument(): void {
	if (unsubscribeChanged) return;
	unsubscribeChanged = window.vetta.agentTeams.onChanged(() => {
		cached = undefined;
		// 在途的那趟请求发出得比这次变更早，拿回来的是旧文档；丢掉它重新发一趟。
		inflight = undefined;
		loadAgentTeamDocument().catch(() => {
			// 刷新失败就留着空缓存：下一个消费者挂载时自然会重试。
		});
	});
}

export function cachedAgentTeamDocument(): AgentTeamDocument | undefined {
	return cached;
}

export function subscribeAgentTeamDocument(listener: () => void): () => void {
	watchAgentTeamDocument();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 拉取名录：已有在途请求时复用它，成功后更新缓存并通知订阅者。失败不写缓存，下次重试。 */
export function loadAgentTeamDocument(): Promise<AgentTeamDocument> {
	inflight ??= window.vetta.agentTeams
		.list()
		.then((document) => {
			cached = document;
			for (const listener of [...listeners]) listener();
			return document;
		})
		.finally(() => {
			inflight = undefined;
		});
	return inflight;
}

/** 仅供测试：清掉跨用例残留的缓存。 */
export function resetAgentTeamDirectoryForTest(): void {
	cached = undefined;
	inflight = undefined;
	listeners.clear();
	unsubscribeChanged?.();
	unsubscribeChanged = undefined;
}

/**
 * 订阅名录缓存的智能体/团队文档。
 *
 * 加载失败静默：同屏的选择器已经有重试入口，不要为同一次失败在多处提示。
 */
export function useAgentTeamDirectoryDocument(): AgentTeamDocument | undefined {
	const [document, setDocument] = useState(cachedAgentTeamDocument);
	useEffect(() => {
		const unsubscribe = subscribeAgentTeamDocument(() => setDocument(cachedAgentTeamDocument()));
		loadAgentTeamDocument().then(setDocument, () => {});
		return unsubscribe;
	}, []);
	return useLocalizedAgentTeamDocument(document);
}
