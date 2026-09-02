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
import { Virtuoso } from "react-virtuoso";
import {
	buildMessageFeedNavigationOutline,
	findActiveMessageFeedNavigationTurnIndex,
	type MessageFeedNavigationLabels,
	type MessageFeedNavigationTurn,
} from "./navigationModel";

export type { MessageFeedNavigationLabels } from "./navigationModel";

export function MessageFeedNavigation({
	activeItemIndex,
	turns,
	onNavigate,
	labels,
	minimumTurnCount = 1,
}: {
	readonly activeItemIndex: number;
	readonly turns: readonly MessageFeedNavigationTurn[];
	readonly onNavigate: (itemIndex: number) => void;
	readonly labels: MessageFeedNavigationLabels;
	readonly minimumTurnCount?: number;
}): JSX.Element | null {
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const ticks = useMemo(() => buildMessageFeedNavigationOutline(turns, ""), [turns]);
	const visibleItems = useMemo(() => buildMessageFeedNavigationOutline(turns, query), [query, turns]);

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

	if (turns.length < minimumTurnCount) return null;

	const activeTurnNumber =
		turns[findActiveMessageFeedNavigationTurnIndex(turns, activeItemIndex)]?.turnNumber;
	const activeVisibleIndex = visibleItems.findIndex((item) => item.turnNumber === activeTurnNumber);
	const fallbackPreview = (preview: string): string => preview || labels.emptyRequest;

	return (
		<div ref={rootRef}>
			<MessageTimelineView
				label={labels.open}
				open={open}
				trigger={
					<MessageTimelineTriggerView
						label={labels.open}
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
								name: labels.jumpTo(preview),
								onClick: () => onNavigate(tick.targetItemIndex),
							};
						})}
					/>
				}
				panel={
					open ? (
						<MessageTimelinePanelView
							title={labels.title}
							countLabel={labels.count(turns.length)}
							emptyLabel={labels.noResults}
							closeLabel={labels.close}
							onClose={closePanel}
							searchInput={
								<Input
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={labels.searchPlaceholder}
									aria-label={labels.searchLabel}
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
												onClick={() => onNavigate(item.targetItemIndex)}
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
