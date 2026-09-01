import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";
import {
	AgentAvatarView,
	ConversationTimelineView,
	TextBlockView,
} from "@vetta/theme-ui/chat";
import type { TeamChatStatus, TeamMemberViewModel, TeamTimelineItemViewModel } from "./teamChatModel";

export interface TeamMessageFeedProps {
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
	};
}

export function TeamMessageFeed({
	status,
	items,
	members,
	markdown,
	error,
	labels,
}: TeamMessageFeedProps): JSX.Element {
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
		<ConversationTimelineView
			items={items}
			computeItemKey={(_, item) => item.id}
			defaultItemHeight={120}
			followOutput="smooth"
			initialTopMostItemIndex={Math.max(0, items.length - 1)}
			renderItem={(_, item) => (
				<div className="mx-auto w-full max-w-3xl px-4 pb-5">
					<TeamFeedRow item={item} markdown={markdown} sendingLabel={labels.sending} />
				</div>
			)}
		/>
	);
}

function TeamFeedRow({
	item,
	markdown,
	sendingLabel,
}: {
	readonly item: TeamTimelineItemViewModel;
	readonly markdown: RendererMarkdownModel;
	readonly sendingLabel: string;
}): JSX.Element {
	if (item.kind === "user") {
		return (
			<div className="flex min-w-0 justify-end" data-pending={item.pending || undefined}>
				<div className="min-w-0 max-w-[72%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[14px] leading-[1.6] text-foreground data-[pending=true]:opacity-70">
					<TextBlockView {...markdown} text={item.text} />
				</div>
			</div>
		);
	}
	if (item.kind === "delegation") {
		return (
			<div className="flex justify-center px-4 py-1">
				<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/55 px-3 py-1 text-[11px] text-muted-foreground">
					<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">{item.label}</span>
				</div>
			</div>
		);
	}

	return (
		<div
			className="relative flex min-w-0 flex-col overflow-visible rounded-xl"
			aria-live={item.pending ? "polite" : undefined}
		>
			<div className="mb-2 flex items-center gap-2">
				<AgentAvatarView
					name={item.member.name}
					avatar={item.member.avatar}
					blueprintId={item.member.blueprintId}
					active={item.pending}
				/>
				<span className="text-[13px] font-semibold text-foreground/80">{item.member.name}</span>
				{item.pending ? (
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60" />
						{sendingLabel}
					</span>
				) : null}
			</div>
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
		</div>
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
						<div key={member.id} className="flex flex-col items-center gap-1" title={`@${member.handle}`}>
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
