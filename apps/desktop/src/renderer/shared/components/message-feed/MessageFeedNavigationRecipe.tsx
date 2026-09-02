import { Input } from "@shared/components/ui/input";
import { MessageTimeline } from "@vetta/theme-ui/chat";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import {
	MessageFeedNavigation,
	useMessageFeedNavigationContext,
} from "./MessageFeedNavigation";
import {
	buildMessageFeedNavigationOutline,
	findActiveMessageFeedNavigationTurnIndex,
	type MessageFeedNavigationLabels,
	type MessageFeedNavigationTurn,
} from "./navigationModel";

export interface MessageFeedNavigationRecipeProps {
	readonly activeItemIndex: number;
	readonly labels: MessageFeedNavigationLabels;
	readonly onNavigate: (itemIndex: number) => void;
	readonly turns: readonly MessageFeedNavigationTurn[];
}

/**
 * Desktop's standard message-outline recipe. It is intentionally assembled from
 * public behavior and visual primitives, so another feed can replace or reorder
 * any region without adding switches to the primitives.
 */
export function MessageFeedNavigationRecipe(
	props: MessageFeedNavigationRecipeProps,
): JSX.Element {
	return (
		<MessageFeedNavigation.Root>
			<MessageFeedNavigationRecipeContent {...props} />
		</MessageFeedNavigation.Root>
	);
}

function MessageFeedNavigationRecipeContent({
	activeItemIndex,
	labels,
	onNavigate,
	turns,
}: MessageFeedNavigationRecipeProps): JSX.Element {
	const { query } = useMessageFeedNavigationContext("MessageFeedNavigationRecipe");
	const ticks = useMemo(() => buildMessageFeedNavigationOutline(turns, ""), [turns]);
	const visibleItems = useMemo(() => buildMessageFeedNavigationOutline(turns, query), [query, turns]);
	const activeTurnNumber =
		turns[findActiveMessageFeedNavigationTurnIndex(turns, activeItemIndex)]?.turnNumber;
	const activeVisibleIndex = visibleItems.findIndex((item) => item.turnNumber === activeTurnNumber);
	const fallbackPreview = (preview: string): string => preview || labels.emptyRequest;

	return (
		<MessageFeedNavigation.Dismissable asChild>
			<MessageTimeline.Root>
				<MessageFeedNavigation.State asChild>
					<MessageTimeline.Navigation aria-label={labels.open}>
						<MessageFeedNavigation.Trigger asChild>
							<MessageTimeline.Trigger aria-label={labels.open} title={labels.open} />
						</MessageFeedNavigation.Trigger>
						<MessageTimeline.Rail count={ticks.length}>
							{ticks.map((tick, index) => {
								const preview = fallbackPreview(tick.preview);
								return (
									<MessageTimeline.Tick
										key={tick.id}
										index={index}
										count={ticks.length}
										aria-label={labels.jumpTo(preview)}
										aria-current={tick.turnNumber === activeTurnNumber ? "location" : undefined}
										onClick={() => onNavigate(tick.targetItemIndex)}
									>
										<MessageFeedNavigation.Preview>
											<MessageTimeline.TickPreview aria-hidden>
												{preview}
											</MessageTimeline.TickPreview>
										</MessageFeedNavigation.Preview>
									</MessageTimeline.Tick>
								);
							})}
						</MessageTimeline.Rail>
					</MessageTimeline.Navigation>
				</MessageFeedNavigation.State>

				<MessageFeedNavigation.Content>
					<MessageTimeline.PanelPositioner>
						<MessageTimeline.Panel>
							<MessageTimeline.PanelHeader>
								<MessageTimeline.PanelHeading>
									<MessageTimeline.Title asChild>
										<h2>{labels.title}</h2>
									</MessageTimeline.Title>
									<MessageTimeline.Count asChild>
										<span>{labels.count(turns.length)}</span>
									</MessageTimeline.Count>
									<MessageFeedNavigation.Close asChild>
										<MessageTimeline.Close aria-label={labels.close} title={labels.close} />
									</MessageFeedNavigation.Close>
								</MessageTimeline.PanelHeading>
								<MessageFeedNavigation.Search asChild>
									<Input
										type="search"
										placeholder={labels.searchPlaceholder}
										aria-label={labels.searchLabel}
										className="h-7 text-[12px]"
									/>
								</MessageFeedNavigation.Search>
							</MessageTimeline.PanelHeader>
							<MessageTimeline.Body>
								{visibleItems.length > 0 ? (
									<Virtuoso
										data={visibleItems}
										className="h-full overflow-x-hidden"
										initialTopMostItemIndex={Math.max(0, activeVisibleIndex)}
										computeItemKey={(_index, item) => item.id}
										itemContent={(_index, item) => (
											<MessageTimeline.Entry
												aria-current={
													item.turnNumber === activeTurnNumber ? "location" : undefined
												}
												onClick={() => onNavigate(item.targetItemIndex)}
											>
												<MessageTimeline.EntryPreview>
													{fallbackPreview(item.preview)}
												</MessageTimeline.EntryPreview>
												{item.matchPreview ? (
													<MessageTimeline.EntryMatch>
														{item.matchPreview}
													</MessageTimeline.EntryMatch>
												) : null}
											</MessageTimeline.Entry>
										)}
									/>
								) : (
									<MessageTimeline.Empty>{labels.noResults}</MessageTimeline.Empty>
								)}
							</MessageTimeline.Body>
						</MessageTimeline.Panel>
					</MessageTimeline.PanelPositioner>
				</MessageFeedNavigation.Content>
			</MessageTimeline.Root>
		</MessageFeedNavigation.Dismissable>
	);
}
