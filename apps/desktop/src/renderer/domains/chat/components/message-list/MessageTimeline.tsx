import { Input } from "@shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@shared/components/ui/popover";
import {
	MessageTimelineEntryView,
	MessageTimelinePanelView,
	MessageTimelineRailView,
} from "@vetta/theme-ui/chat";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import {
	buildMessageNavigationTurns,
	filterMessageNavigationTurns,
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
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const turns = useMemo(() => buildMessageNavigationTurns(messages), [messages]);
	const visibleTurns = useMemo(() => filterMessageNavigationTurns(turns, query), [query, turns]);
	const visibleEntries = useMemo(() => visibleTurns.flatMap((turn) => turn.entries), [visibleTurns]);

	if (turns.length < MESSAGE_NAVIGATION_MIN_TURNS) return null;

	const activeTurnIndex = findActiveNavigationTurnIndex(turns, activeMessageIndex);
	const activeTurn = Math.min(turns.length, activeTurnIndex + 1);
	const railLabel = t("messageList.navigation.open", {
		current: activeTurn,
		total: turns.length,
	});

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<MessageTimelineRailView
					activeTurn={activeTurn}
					label={railLabel}
					onClick={() => setOpen(true)}
					totalTurns={turns.length}
				/>
			</PopoverTrigger>
			<PopoverContent side="left" align="center" sideOffset={8} className="w-80 overflow-hidden p-0">
				<MessageTimelinePanelView
					title={t("messageList.navigation.title")}
					countLabel={t("messageList.navigation.count", { count: turns.length })}
					emptyLabel={t("messageList.navigation.noResults")}
					searchInput={
						<Input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("messageList.navigation.searchPlaceholder")}
							aria-label={t("messageList.navigation.searchLabel")}
							className="text-[12px]"
						/>
					}
					timeline={
						visibleEntries.length > 0 ? (
							<Virtuoso
								data={visibleEntries}
								className="h-full"
								computeItemKey={(_index, entry) => entry.id}
								itemContent={(_index, entry) => {
									const preview =
										entry.preview ||
										t(
											entry.role === "user"
												? "messageList.navigation.emptyUser"
												: "messageList.navigation.emptyAssistant",
										);
									return (
										<MessageTimelineEntryView
											active={entry.messageIndex === activeMessageIndex}
											preview={preview}
											roleLabel={t(
												entry.role === "user"
													? "messageList.navigation.userRole"
													: "messageList.navigation.assistantRole",
											)}
											turnLabel={t("messageList.navigation.turn", {
												turn: entry.turnNumber,
											})}
											onClick={() => onNavigate(entry.messageIndex)}
										/>
									);
								}}
							/>
						) : null
					}
				/>
			</PopoverContent>
		</Popover>
	);
}
