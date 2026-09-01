import { MarkdownContent } from "@domains/chat/components/blocks/TextBlock";
import type {
	AgentProfile,
	AgentTeamDocument,
	TeamDefinition,
	TeamFeedEvent,
	TeamSessionDocument,
} from "@vetta/agent-team";
import { VirtuosoListContainer } from "@vetta/theme-ui/chat";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { agentDisplayName } from "../../lib/preset-presentation";

export interface TeamMessageFeedProps {
	readonly document?: AgentTeamDocument;
	readonly team?: TeamDefinition;
	readonly session?: TeamSessionDocument;
	readonly pendingText?: string;
	readonly streamingByMember: Readonly<Record<string, string>>;
	readonly sending: boolean;
}

export function TeamMessageFeed(props: TeamMessageFeedProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const profilesByMemberId = useMemo(() => {
		const profiles = new Map<string, AgentProfile>();
		if (!props.document || !props.team) return profiles;
		for (const member of props.team.members) {
			const profile = props.document.agents.find(
				(agent) => agent.id === member.binding.agentProfileId,
			);
			if (profile) profiles.set(member.id, profile);
		}
		return profiles;
	}, [props.document, props.team]);
	const feed = useMemo<TeamFeedItem[]>(() => {
		const events = props.session?.events.map((event) => ({ kind: "event" as const, event })) ?? [];
		const pendingUserAlreadyCommitted = props.pendingText
			? props.session?.events.some((event) => event.type === "user-message" && event.text === props.pendingText)
			: false;
		const streaming = Object.entries(props.streamingByMember).map(([memberId, text]) => ({
			kind: "streaming-agent" as const,
			memberId,
			text,
		}));
		return props.pendingText && !pendingUserAlreadyCommitted
			? [
					...events,
					{ kind: "pending-user" as const, text: props.pendingText },
					...streaming,
					...(streaming.length === 0 ? [{ kind: "pending-agent" as const }] : []),
				]
			: [...events, ...streaming];
	}, [props.pendingText, props.session?.events, props.streamingByMember]);

	if (!props.session) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
				<span
					className="icon-[solar--refresh-linear] mr-2 h-4 w-4 animate-spin"
					aria-hidden="true"
				/>
				{t("loading")}
			</div>
		);
	}
	if (feed.length === 0) {
		return <TeamEmptyState document={props.document} team={props.team} />;
	}

	return (
		<div className="@container relative flex min-h-0 flex-1 flex-col">
			<Virtuoso
				data={feed}
				className="flex-1 pt-2"
				components={{ List: VirtuosoListContainer }}
				followOutput="smooth"
				initialTopMostItemIndex={Math.max(0, feed.length - 1)}
				itemContent={(_, item) => (
					<div className="pb-5">
						<TeamFeedRow
							item={item}
							session={props.session as TeamSessionDocument}
							profilesByMemberId={profilesByMemberId}
							sending={props.sending}
						/>
					</div>
				)}
			/>
		</div>
	);
}

type TeamFeedItem =
	| { readonly kind: "event"; readonly event: TeamFeedEvent }
	| { readonly kind: "pending-user"; readonly text: string }
	| { readonly kind: "pending-agent" }
	| { readonly kind: "streaming-agent"; readonly memberId: string; readonly text: string };

function TeamFeedRow({
	item,
	session,
	profilesByMemberId,
	sending,
}: {
	readonly item: TeamFeedItem;
	readonly session: TeamSessionDocument;
	readonly profilesByMemberId: ReadonlyMap<string, AgentProfile>;
	readonly sending: boolean;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	if (item.kind === "pending-user") return <UserResult text={item.text} />;
	if (item.kind === "streaming-agent") {
		const profile = profilesByMemberId.get(item.memberId);
		return (
			<AgentResult
				name={memberLabel(item.memberId, session, profilesByMemberId, t)}
				blueprintId={profile?.blueprintId ?? "leader"}
				text={item.text}
				pending
			/>
		);
	}
	if (item.kind === "pending-agent") {
		return (
			<AgentResult
				name={t("chat.teamWorking")}
				blueprintId="leader"
				text=""
				pending={sending}
			/>
		);
	}
	const event = item.event;
	if (event.type === "user-message") return <UserResult text={event.text} />;
	if (event.type === "member-delegation") {
		return (
			<div className="flex justify-center px-4 py-1">
				<div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/55 px-3 py-1 text-[11px] text-muted-foreground">
					<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">
						{t("chat.delegation", {
							from: memberLabel(event.sourceMemberId, session, profilesByMemberId, t),
							to: memberLabel(event.targetMemberId, session, profilesByMemberId, t),
						})}
					</span>
				</div>
			</div>
		);
	}
	const profile = profilesByMemberId.get(event.memberId);
	return (
		<AgentResult
			name={memberLabel(event.memberId, session, profilesByMemberId, t)}
			blueprintId={profile?.blueprintId ?? "leader"}
			text={event.text}
		/>
	);
}

function UserResult({ text }: { readonly text: string }): JSX.Element {
	return (
		<div className="flex min-w-0 justify-end">
			<div className="min-w-0 max-w-[72%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[14px] leading-[1.6] text-foreground">
				<MarkdownContent text={text} />
			</div>
		</div>
	);
}

function AgentResult({
	name,
	blueprintId,
	text,
	pending = false,
}: {
	readonly name: string;
	readonly blueprintId: string;
	readonly text: string;
	readonly pending?: boolean;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div className="relative flex min-w-0 flex-col overflow-visible rounded-xl">
			<div className="mb-2 flex items-center gap-2">
				<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<span className={`${blueprintIcon(blueprintId)} h-4 w-4`} aria-hidden="true" />
				</div>
				<span className="text-[13px] font-semibold text-foreground/80">{name}</span>
				{pending && (
					<span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60" />
						{t("chat.sending")}
					</span>
				)}
			</div>
			{pending && !text ? (
				<div className="h-4 w-40 animate-pulse rounded bg-muted/60" />
			) : (
				<MarkdownContent text={text || "…"} className="text-[14px] leading-[1.6]" />
			)}
		</div>
	);
}

function TeamEmptyState({
	document,
	team,
}: {
	readonly document?: AgentTeamDocument;
	readonly team?: TeamDefinition;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
			<div className="w-full max-w-2xl text-center">
				<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
					<span
						className="icon-[solar--users-group-rounded-bold] h-6 w-6"
						aria-hidden="true"
					/>
				</div>
				<h2 className="mt-4 text-xl font-semibold text-foreground">{t("chat.readyTitle")}</h2>
				<p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
					{t("chat.readyDescription")}
				</p>
				<div className="mt-5 flex flex-wrap justify-center gap-2">
					{team?.members.map((member) => {
						const profile = document?.agents.find(
							(agent) => agent.id === member.binding.agentProfileId,
						);
						return (
							<span
								key={member.id}
								className="inline-flex items-center gap-1.5 rounded-full bg-muted/55 px-3 py-1.5 text-xs text-muted-foreground"
							>
								<span
									className={`${blueprintIcon(profile?.blueprintId ?? "leader")} h-3.5 w-3.5`}
									aria-hidden="true"
								/>
								@{member.handle}
							</span>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function memberLabel(
	memberId: string,
	session: TeamSessionDocument,
	profilesByMemberId: ReadonlyMap<string, AgentProfile>,
	t: TFunction<"agent-teams">,
): string {
	const profile = profilesByMemberId.get(memberId);
	return profile ? agentDisplayName(profile, t) : session.memberHandles[memberId] ?? memberId;
}

function blueprintIcon(blueprintId: string): string {
	if (blueprintId === "researcher") return "icon-[solar--magnifer-linear]";
	if (blueprintId === "builder") return "icon-[solar--code-square-linear]";
	if (blueprintId === "reviewer") return "icon-[solar--shield-check-linear]";
	return "icon-[solar--crown-star-linear]";
}
