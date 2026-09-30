import {
	type ChatConversationItem,
	conversationFeedAtom,
	projectsAtom,
	promptPredictingAtom,
	promptSuggestionsAtom,
} from "@shared/store/atoms";
import { getDefaultStore, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useRef } from "react";
import type { ActiveSessionHandle } from "./session-manager-types";

/**
 * Input suggestions after a completed Turn (0-3, experimental). A new Turn or a
 * new prompt bumps the session's token so a late result is dropped.
 */
export function usePromptPrediction(activeSessionRef: MutableRefObject<ActiveSessionHandle | null>) {
	const setPromptSuggestions = useSetAtom(promptSuggestionsAtom);
	const setPromptPredicting = useSetAtom(promptPredictingAtom);
	const tokensRef = useRef<Map<string, number>>(new Map());

	const bumpSuggestionToken = useCallback((runtimeId: string) => {
		const tokens = tokensRef.current;
		tokens.set(runtimeId, (tokens.get(runtimeId) ?? 0) + 1);
	}, []);

	const markPredicting = useCallback(
		(runtimeId: string, predicting: boolean) => {
			setPromptPredicting((previous) => {
				if (predicting) return { ...previous, [runtimeId]: true };
				if (!(runtimeId in previous)) return previous;
				const next = { ...previous };
				delete next[runtimeId];
				return next;
			});
		},
		[setPromptPredicting],
	);

	const predictNextPrompts = useCallback(
		(runtimeId: string) => {
			const cwd = activeSessionRef.current?.cwd;
			const store = getDefaultStore();
			const projectType = cwd ? store.get(projectsAtom).find((project) => project.cwd === cwd)?.type : undefined;
			if (projectType === "batch") return;
			const conversation = buildRecentConversation(store.get(conversationFeedAtom).items);
			const token = tokensRef.current.get(runtimeId) ?? 0;
			void (async () => {
				try {
					const config = await window.vetta.config.get();
					if (config.experimental?.promptPrediction !== true) return;
					if (!conversation) return;
					// 进入「生成中」：末条 assistant 操作栏显示闪光提示。
					markPredicting(runtimeId, true);
					const suggestions = await window.vetta.session.nextPromptSuggestions(runtimeId, conversation);
					// 过期判定：该会话期间已开新轮 / 发新 prompt 则丢弃。
					if ((tokensRef.current.get(runtimeId) ?? 0) !== token) return;
					setPromptSuggestions((previous) => {
						if (suggestions.length > 0) return { ...previous, [runtimeId]: suggestions };
						if (!(runtimeId in previous)) return previous;
						const next = { ...previous };
						delete next[runtimeId];
						return next;
					});
				} catch (error) {
					console.warn("[useSessionManager] prompt prediction failed", error);
				} finally {
					markPredicting(runtimeId, false);
				}
			})();
		},
		[activeSessionRef, markPredicting, setPromptSuggestions],
	);

	return { bumpSuggestionToken, predictNextPrompts };
}

function buildRecentConversation(messages: readonly ChatConversationItem[]): string {
	const relevant = messages.filter((message) => message.kind !== "event");
	let startIndex = relevant.length;
	let userCount = 0;
	for (let index = relevant.length - 1; index >= 0; index--) {
		if (relevant[index].kind === "user") {
			userCount++;
			startIndex = index;
			if (userCount >= 3) break;
		}
	}
	const lines: string[] = [];
	for (const message of relevant.slice(startIndex)) {
		const text = (message.text ?? "").trim();
		if (!text) continue;
		lines.push(`${message.kind === "user" ? "User" : "Assistant"}: ${text.slice(0, 600)}`);
	}
	return lines.join("\n\n").slice(0, 4000);
}
