import {
	type MessageFeedNavigationLabels,
} from "@shared/components/message-feed/MessageFeedNavigation";
import { MessageFeedNavigationRecipe } from "@shared/components/message-feed/MessageFeedNavigationRecipe";
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

const shouldFollowUserItem = (item: TeamTimelineItemViewModel): boolean =>
	item.kind === "message" && item.message.kind === "user";

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
									<TeamFeedItem item={item} members={members} markdown={markdown} labels={labels} />
								</div>
							)}
						</MessageFeed.VirtualList>
					</MessageFeedLayout.Virtualizer>
				</MessageFeedLayout.Viewport>
				<MessageFeedLayout.LeftRail>
					<MessageFeedLayout.RailContent>
						{navigationTurns.length >= NAVIGATION_MIN_TURNS ? (
							<MessageFeedNavigationRecipe
								activeItemIndex={activeItem.activeIndex}
								turns={navigationTurns}
								onNavigate={scroll.scrollToItem}
								labels={labels.navigation}
							/>
						) : null}
					</MessageFeedLayout.RailContent>
				</MessageFeedLayout.LeftRail>
			</MessageFeedLayout.Frame>
		</MessageFeed.Root>
	);
}

function TeamFeedItem({
	item,
	members,
	markdown,
	labels,
}: {
	readonly item: TeamTimelineItemViewModel;
	readonly members: readonly TeamMemberViewModel[];
	readonly markdown: RendererMarkdownModel;
	readonly labels: TeamMessageFeedProps["labels"];
}): JSX.Element {
	if (item.kind === "event") {
		return (
			<Message.Root>
				<MessageLayout.Event>
					<MessageVisual.EventBubble>
						<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						<span className="truncate">{item.event.label}</span>
					</MessageVisual.EventBubble>
				</MessageLayout.Event>
			</Message.Root>
		);
	}

	const conversationMessage = item.message;
	if (conversationMessage.kind === "user") {
		const pending = conversationMessage.deliveryPhase === "pending";
		return (
			<Message.Root pending={pending}>
				<MessageLayout.Outgoing>
					<MessageLayout.OutgoingContent>
						{conversationMessage.attachments?.length ? (
							<MessageLayout.BeforeBody>
								<TeamMessageAttachments attachments={conversationMessage.attachments} markdown={markdown} />
							</MessageLayout.BeforeBody>
						) : null}
						{conversationMessage.text ? (
							<MessageVisual.OutgoingBubble>
								<TextBlockView {...markdown} text={conversationMessage.text} />
							</MessageVisual.OutgoingBubble>
						) : null}
						{conversationMessage.text ? (
							<MessageLayout.Footer>
								<CopyButton
									getText={() => conversationMessage.text}
									labels={{ copy: labels.copy, copied: labels.copied }}
								/>
							</MessageLayout.Footer>
						) : null}
					</MessageLayout.OutgoingContent>
				</MessageLayout.Outgoing>
			</Message.Root>
		);
	}

	const member =
		members.find((candidate) => candidate.id === conversationMessage.authorId) ??
		({
			id: conversationMessage.authorId,
			kind: "agent",
			name: conversationMessage.authorId,
			handle: conversationMessage.authorId,
			blueprintId: "leader",
			selected: false,
			status: "idle",
		} satisfies TeamMemberViewModel);
	const text = conversationMessage.blocks
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n");
	const pending = conversationMessage.phase === "pending" || conversationMessage.phase === "streaming";
	const failed = conversationMessage.phase === "failed";
	return (
		<Message.Root pending={pending}>
			<MessageLayout.Incoming aria-live={pending ? "polite" : undefined}>
				<MessageLayout.Header>
					<MessageLayout.HeaderLeading>
						<AgentAvatarView
							name={member.name}
							avatar={member.avatar}
							blueprintId={member.blueprintId}
							active={pending}
						/>
					</MessageLayout.HeaderLeading>
					<Message.Author>{member.name}</Message.Author>
					{pending ? (
						<Message.Status className="text-[11px] text-muted-foreground/70">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60" />
							{labels.sending}
						</Message.Status>
					) : null}
				</MessageLayout.Header>
				<div>
					{pending && !text ? (
						<div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
					) : (
						<TextBlockView
							{...markdown}
							text={text || "…"}
							isStreamingTail={pending}
							className={failed ? "text-destructive" : "text-[14px] leading-[1.6]"}
						/>
					)}
				</div>
				{text ? (
					<MessageLayout.Footer>
						<CopyButton getText={() => text} labels={{ copy: labels.copy, copied: labels.copied }} />
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
