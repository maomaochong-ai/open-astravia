import {
	MessageFeedNavigation,
	type MessageFeedNavigationLabels,
} from "@shared/components/message-feed/MessageFeedNavigation";
import { useMessageFeedActiveItem } from "@shared/components/message-feed/useMessageFeedActiveItem";
import { useMessageFeedScrollModel } from "@shared/components/message-feed/useMessageFeedScrollModel";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import {
	AgentAvatarView,
	CopyButton,
	Message,
	MessageFeed,
	MessageFeedLayout,
	MessageLayout,
	MessageVisual,
	TextBlockView,
} from "@vetta/theme-ui/chat";
import type { PromptAttachmentRef } from "@vetta/runtime-core";
import { useMemo } from "react";
import {
	buildTeamNavigationTurns,
	type TeamChatStatus,
	type TeamMemberViewModel,
	type TeamTimelineItemViewModel,
} from "./teamChatModel";

const ACTIVE_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const NAVIGATION_MIN_TURNS = 8;
const ACTIVE_VIEWPORT = { top: 0, bottom: 80 };
const IDLE_VIEWPORT = { top: 200, bottom: 200 };

export interface TeamMessageFeedProps {
	readonly feedKey: string;
	readonly status: TeamChatStatus;
	readonly items: readonly TeamTimelineItemViewModel[];
	readonly members: readonly TeamMemberViewModel[];
	readonly markdown: RendererMarkdownModel;
	readonly error?: string;
	readonly labels: {
		readonly loading: string;
		readonly readyTitle: string;
		readonly readyDescription: string;
		readonly sending: string;
		readonly failed: string;
		readonly copy: string;
		readonly copied: string;
		readonly navigation: MessageFeedNavigationLabels;
	};
}

const shouldFollowUserItem = (item: TeamTimelineItemViewModel): boolean => item.kind === "user";

export function TeamMessageFeed({
	feedKey,
	status,
	items,
	members,
	markdown,
	error,
	labels,
}: TeamMessageFeedProps): JSX.Element {
	const active = status === "sending" || status === "streaming" || status === "cancelling";
	const scroll = useMessageFeedScrollModel({
		active,
		items,
		resetKey: feedKey,
		shouldFollowOnAppend: shouldFollowUserItem,
	});
	const activeItem = useMessageFeedActiveItem<TeamTimelineItemViewModel>({
		scrollerElement: scroll.scrollerElement,
		resetKey: feedKey,
		initialIndex: Math.max(0, items.length - 1),
	});
	const navigationTurns = useMemo(() => buildTeamNavigationTurns(items), [items]);

	if (status === "loading") {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
				<span className="icon-[solar--refresh-linear] mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
				{labels.loading}
			</div>
		);
	}
	if (status === "error" && items.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-destructive" role="alert">
				{error ?? labels.failed}
			</div>
		);
	}
	if (items.length === 0) return <TeamEmptyState members={members} labels={labels} />;

	return (
		<MessageFeed.Root>
			<MessageFeedLayout.Frame>
				<MessageFeedLayout.Viewport>
					<MessageFeedLayout.Virtualizer asChild>
						<MessageFeed.VirtualList
							virtuosoRef={scroll.virtuosoRef}
							scrollerRef={scroll.scrollerRef}
							atBottomStateChange={scroll.onAtBottomChange}
							atBottomThreshold={80}
							items={items}
							getKey={(item) => item.id}
							itemsRendered={activeItem.onItemsRendered}
							defaultItemHeight={120}
							overscan={active ? ACTIVE_OVERSCAN : IDLE_OVERSCAN}
							increaseViewportBy={active ? ACTIVE_VIEWPORT : IDLE_VIEWPORT}
							initialTopMostItemIndex={Math.max(0, items.length - 1)}
						>
							<MessageFeedLayout.List />
							{(item) => (
								<div className="mx-auto w-full max-w-3xl px-4 pb-5">
									<TeamFeedItem item={item} markdown={markdown} labels={labels} />
								</div>
							)}
						</MessageFeed.VirtualList>
					</MessageFeedLayout.Virtualizer>
				</MessageFeedLayout.Viewport>
				<MessageFeedLayout.LeftRail>
					<MessageFeedLayout.RailContent>
						<MessageFeedNavigation
							activeItemIndex={activeItem.activeIndex}
							turns={navigationTurns}
							onNavigate={scroll.scrollToItem}
							labels={labels.navigation}
							minimumTurnCount={NAVIGATION_MIN_TURNS}
						/>
					</MessageFeedLayout.RailContent>
				</MessageFeedLayout.LeftRail>
			</MessageFeedLayout.Frame>
		</MessageFeed.Root>
	);
}

function TeamFeedItem({
	item,
	markdown,
	labels,
}: {
	readonly item: TeamTimelineItemViewModel;
	readonly markdown: RendererMarkdownModel;
	readonly labels: TeamMessageFeedProps["labels"];
}): JSX.Element {
	if (item.kind === "user") {
		return (
			<Message.Root pending={item.pending}>
				<MessageLayout.Outgoing>
					<MessageLayout.OutgoingContent>
					{item.attachments.length > 0 ? (
						<MessageLayout.BeforeBody asChild>
							<Message.Attachments>
								<TeamMessageAttachments attachments={item.attachments} markdown={markdown} />
							</Message.Attachments>
						</MessageLayout.BeforeBody>
					) : null}
					{item.text ? (
						<MessageVisual.OutgoingBubble>
							<TextBlockView {...markdown} text={item.text} />
						</MessageVisual.OutgoingBubble>
					) : null}
					{item.text ? (
						<MessageLayout.Footer asChild>
							<Message.Actions className="h-6 items-center justify-end">
								<CopyButton
									getText={() => item.text}
									labels={{ copy: labels.copy, copied: labels.copied }}
								/>
							</Message.Actions>
						</MessageLayout.Footer>
					) : null}
					</MessageLayout.OutgoingContent>
				</MessageLayout.Outgoing>
			</Message.Root>
		);
	}
	if (item.kind === "delegation") {
		return (
			<Message.Root>
				<MessageLayout.Event>
				<MessageVisual.EventBubble>
					<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">{item.label}</span>
				</MessageVisual.EventBubble>
				</MessageLayout.Event>
			</Message.Root>
		);
	}

	return (
		<Message.Root pending={item.pending}>
			<MessageLayout.Incoming aria-live={item.pending ? "polite" : undefined}>
				<MessageLayout.Header>
					<MessageLayout.HeaderLeading asChild>
						<Message.Avatar>
							<AgentAvatarView
								name={item.member.name}
								avatar={item.member.avatar}
								blueprintId={item.member.blueprintId}
								active={item.pending}
							/>
						</Message.Avatar>
					</MessageLayout.HeaderLeading>
					<Message.Author>{item.member.name}</Message.Author>
					{item.pending ? (
						<Message.Status className="text-[11px] text-muted-foreground/70">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60" />
							{labels.sending}
						</Message.Status>
					) : null}
				</MessageLayout.Header>
				<Message.Content>
					{item.pending && !item.text ? (
						<div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
					) : (
						<TextBlockView
							{...markdown}
							text={item.text || item.error || "…"}
							isStreamingTail={item.pending}
							className={item.error ? "text-destructive" : "text-[14px] leading-[1.6]"}
						/>
					)}
				</Message.Content>
				{item.text ? (
					<MessageLayout.Footer asChild>
						<Message.Actions className="h-6">
							<CopyButton
								getText={() => item.text}
								labels={{ copy: labels.copy, copied: labels.copied }}
							/>
						</Message.Actions>
					</MessageLayout.Footer>
				) : null}
			</MessageLayout.Incoming>
		</Message.Root>
	);
}

function TeamMessageAttachments({
	attachments,
	markdown,
}: {
	readonly attachments: readonly PromptAttachmentRef[];
	readonly markdown: RendererMarkdownModel;
}): JSX.Element {
	return (
		<>
			{attachments.map((attachment) => {
				const name = pathBasename(attachment.path);
				if (attachment.kind === "image") {
					return (
						<button
							key={`${attachment.kind}:${attachment.path}`}
							type="button"
							onClick={() => markdown.onOpenFile(attachment.path)}
							className="group relative h-20 w-20 overflow-hidden rounded-xl border border-border/60 bg-muted/60 transition-colors hover:border-primary/50"
							title={name}
						>
							<img src={toVettaFileUrl(attachment.path)} alt={name} className="h-full w-full object-cover" />
						</button>
					);
				}
				return (
					<button
						key={`${attachment.kind}:${attachment.path}`}
						type="button"
						onClick={() => markdown.onOpenFile(attachment.path)}
						className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
						title={name}
					>
						<span className="icon-[solar--file-linear] h-3 w-3" aria-hidden="true" />
						<span className="truncate">{name}</span>
					</button>
				);
			})}
		</>
	);
}

function TeamEmptyState({
	members,
	labels,
}: {
	readonly members: readonly TeamMemberViewModel[];
	readonly labels: TeamMessageFeedProps["labels"];
}): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
			<div className="w-full max-w-2xl text-center">
				<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
					<span className="icon-[solar--users-group-rounded-bold] h-6 w-6" aria-hidden="true" />
				</div>
				<h2 className="mt-4 text-xl font-semibold text-foreground">{labels.readyTitle}</h2>
				<p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
					{labels.readyDescription}
				</p>
				<div className="mt-5 flex flex-wrap justify-center gap-2">
					{members.map((member) => (
						<div key={member.id} className="flex flex-col items-center gap-1" title={member.name}>
							<AgentAvatarView
								name={member.name}
								avatar={member.avatar}
								blueprintId={member.blueprintId}
								size="md"
							/>
							<span className="max-w-20 truncate text-[11px] text-muted-foreground">{member.name}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
