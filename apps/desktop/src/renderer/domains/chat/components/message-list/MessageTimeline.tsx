import { Input } from "@shared/components/ui/input";
import { useShortcutScope } from "@shared/shortcuts";
import {
	MessageTimelineEntryView,
	MessageTimelinePanelView,
	MessageTimelineRailView,
	MessageTimelineTriggerView,
	MessageTimelineView,
} from "@vetta/theme-ui/chat";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import {
	buildMessageNavigationOutline,
	buildMessageNavigationTurns,
	findActiveNavigationTurnIndex,
	MESSAGE_NAVIGATION_MIN_TURNS,
} from "./messageNavigationModel";
import type { ChatMessage } from "./types";

export function MessageTimeline({
	activeMessageIndex,
	messages,
	onNavigate,
}: {
	activeMessageIndex: number;
	messages: ChatMessage[];
	onNavigate: (messageIndex: number) => void;
}): JSX.Element | null {
	const { t } = useTranslation("chat");
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const turns = useMemo(() => buildMessageNavigationTurns(messages), [messages]);
	const ticks = useMemo(() => buildMessageNavigationOutline(turns, ""), [turns]);
	const visibleItems = useMemo(() => buildMessageNavigationOutline(turns, query), [query, turns]);

	const closePanel = (): void => {
		setOpen(false);
		setQuery("");
	};

	useShortcutScope({
		id: "overlay:message-outline",
		kind: "overlay",
		active: open,
		bindings: [{ key: "escape", run: closePanel }],
	});

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
			setOpen(false);
			setQuery("");
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	if (turns.length < MESSAGE_NAVIGATION_MIN_TURNS) return null;

	const activeTurnNumber = turns[findActiveNavigationTurnIndex(turns, activeMessageIndex)]?.turnNumber;
	const activeVisibleIndex = visibleItems.findIndex((item) => item.turnNumber === activeTurnNumber);
	const fallbackPreview = (preview: string): string => preview || t("messageList.navigation.emptyUser");

	return (
		<div ref={rootRef}>
			<MessageTimelineView
				label={t("messageList.navigation.open")}
				open={open}
				trigger={
					<MessageTimelineTriggerView
						label={t("messageList.navigation.open")}
						aria-expanded={open}
						data-state={open ? "open" : "closed"}
						onClick={() => {
							if (open) closePanel();
							else setOpen(true);
						}}
					/>
				}
				rail={
					<MessageTimelineRailView
						showPreview={!open}
						ticks={ticks.map((tick) => {
							const preview = fallbackPreview(tick.preview);
							return {
								active: tick.turnNumber === activeTurnNumber,
								id: tick.id,
								label: preview,
								name: t("messageList.navigation.jumpTo", { preview }),
								onClick: () => onNavigate(tick.targetMessageIndex),
							};
						})}
					/>
				}
				panel={
					open ? (
						<MessageTimelinePanelView
							title={t("messageList.navigation.title")}
							countLabel={t("messageList.navigation.count", { count: turns.length })}
							emptyLabel={t("messageList.navigation.noResults")}
							closeLabel={t("messageList.navigation.close")}
							onClose={closePanel}
							searchInput={
								<Input
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={t("messageList.navigation.searchPlaceholder")}
									aria-label={t("messageList.navigation.searchLabel")}
									className="h-7 text-[12px]"
								/>
							}
							timeline={
								visibleItems.length > 0 ? (
									<Virtuoso
										data={visibleItems}
										className="h-full overflow-x-hidden"
										initialTopMostItemIndex={Math.max(0, activeVisibleIndex)}
										computeItemKey={(_index, item) => item.id}
										itemContent={(_index, item) => (
											<MessageTimelineEntryView
												active={item.turnNumber === activeTurnNumber}
												matchPreview={item.matchPreview}
												preview={fallbackPreview(item.preview)}
												onClick={() => onNavigate(item.targetMessageIndex)}
											/>
										)}
									/>
								) : null
							}
						/>
					) : null
				}
			/>
		</div>
	);
}
