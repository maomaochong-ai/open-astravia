import { activeSessionAtom, conversationBucketCwd, defaultConversationCwdAtom } from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

/**
 * 「新会话」入口的统一行为：解析目标项目 cwd 并跳转到 NewSession 页。
 * 侧边栏导航项与会话页顶栏按钮共用，避免目标 cwd 解析规则出现第二处实现。
 */
export function useNewChatNavigation(): () => void {
	const navigate = useNavigate();
	const matches = useMatches();
	const lastMatch = matches[matches.length - 1];
	const currentPath = lastMatch?.pathname ?? "/";
	const activeSession = useAtomValue(activeSessionAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const setDefaultConversationCwd = useSetAtom(defaultConversationCwdAtom);

	// 目标 cwd 解析顺序：
	//   1. 当前路由参数 cwd（/project/$cwd 或 /new-session/$cwd）—— 项目详情聚焦
	//   2. 仅在聊天页（/）时，跟随 activeSession 的 cwd —— 聚焦的是「某项目的会话」时落到该项目。
	//      ADR-0007：默认「对话」session 的运行 cwd 是默认项目根下的 per-session 子目录，
	//      必须归一回项目根，否则新会话会挂到子目录 bucket、不在「会话」列表出现。
	//   3. 其余一切场景（自动化/批量任务/Claw 查看器/设置等）落到默认「会话」项目，
	//      不能沿用残留的 activeSession.cwd，否则会把新会话建到上一个项目里。
	const newChatCwd = (() => {
		const params = lastMatch?.params as { cwd?: string } | undefined;
		if (params?.cwd) {
			try {
				return decodeURIComponent(params.cwd);
			} catch {
				return params.cwd;
			}
		}
		if (currentPath === "/" && activeSession?.cwd) {
			return conversationBucketCwd(activeSession.cwd, defaultConversationCwd);
		}
		return defaultConversationCwd || "";
	})();

	return useCallback(() => {
		void (async () => {
			let targetCwd = newChatCwd;
			if (!targetCwd) {
				try {
					const config = await window.vetta.config.get();
					targetCwd = config.defaultConversationCwd ?? "";
					if (targetCwd) setDefaultConversationCwd(targetCwd);
				} catch (error) {
					console.error("[NewChat] failed to resolve default conversation cwd", error);
				}
			}
			if (!targetCwd) return;
			void navigate({
				to: "/new-session/$cwd",
				params: { cwd: encodeURIComponent(targetCwd) },
			});
		})();
	}, [navigate, newChatCwd, setDefaultConversationCwd]);
}
