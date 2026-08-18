import {
	activeSessionAtom,
	conversationBucketCwd,
	defaultConversationCwdAtom,
	openSessionFnRef,
	pendingScrollToEntryAtom,
} from "@shared/store/atoms";
import { ForkOriginBannerView } from "@vetta/theme-ui/chat";
import { getDefaultStore, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./types";

interface ForkOriginBannerProps {
	/** Source user message text for preview (the forked bubble). */
	sourceMessage?: ChatMessage;
}

function previewText(text: string | undefined, max = 48): string {
	const t = (text ?? "").replace(/\s+/g, " ").trim();
	if (!t) return "";
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Inline “forked from” hint rendered under the forked turn’s AI reply. */
export function ForkOriginBanner({ sourceMessage }: ForkOriginBannerProps): JSX.Element | null {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);

	const parentSessionPath = activeSession?.parentSessionPath;
	const parentEntryId = activeSession?.parentEntryId;

	const preview = useMemo(() => previewText(sourceMessage?.text), [sourceMessage?.text]);

	const onClick = useCallback(() => {
		if (!parentSessionPath || !activeSession) return;
		const store = getDefaultStore();
		if (parentEntryId) {
			store.set(pendingScrollToEntryAtom, { entryId: parentEntryId });
		}
		const open = openSessionFnRef.current;
		if (!open) return;
		const bucketCwd = conversationBucketCwd(activeSession.cwd, defaultConversationCwd);
		void open(bucketCwd, parentSessionPath).catch((err) => {
			console.warn("[ForkOriginBanner] open parent session failed", err);
			store.set(pendingScrollToEntryAtom, null);
		});
	}, [activeSession, defaultConversationCwd, parentEntryId, parentSessionPath]);

	if (!parentSessionPath) return null;

	const label = preview
		? t("messageList.forkOrigin.labelWithPreview")
		: t("messageList.forkOrigin.label");

	return (
		<ForkOriginBannerView label={label} preview={preview || undefined} onClick={onClick} />
	);
}

export interface ForkOriginPlacement {
	/** Index of the row after which the hint is rendered (AI tip of the forked turn). */
	anchorIndex: number;
	/** Index of the forked user message (for preview text). */
	sourceUserIndex: number;
}

/**
 * Place the fork-origin hint under the AI reply of the forked turn
 * (user + following non-user messages; tip = last assistant/compaction in that turn).
 */
export function resolveForkOriginPlacement(
	messages: ChatMessage[],
	parentEntryId: string | undefined,
	hasParentSession: boolean,
): ForkOriginPlacement | null {
	if (!hasParentSession || messages.length === 0) return null;

	let sourceUserIndex = -1;
	if (parentEntryId) {
		sourceUserIndex = messages.findIndex(
			(m) => m.role === "user" && (m.entryId === parentEntryId || m.id === parentEntryId),
		);
	}
	if (sourceUserIndex < 0) {
		// Older forks without parentEntryId: last user message in the export.
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				sourceUserIndex = i;
				break;
			}
		}
	}
	if (sourceUserIndex < 0) return null;

	// Walk forward past assistant/compaction of this turn; stop before next user.
	let anchorIndex = sourceUserIndex;
	for (let i = sourceUserIndex + 1; i < messages.length; i++) {
		if (messages[i].role === "user") break;
		anchorIndex = i;
	}
	return { anchorIndex, sourceUserIndex };
}
