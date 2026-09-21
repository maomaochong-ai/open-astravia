import { cn } from "@shared/lib/utils";
import { AgentAvatarView } from "@vetta-org/theme-ui/chat";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TeamChatViewModel } from "./teamChatModel";

export interface TeamMemberRosterWidth {
	readonly natural: number;
	readonly compact: number;
}

/**
 * Share the available label space across every member. Short labels stop growing
 * at their natural width and return the remainder to longer labels.
 */
export function allocateTeamMemberRosterWidths(
	members: readonly TeamMemberRosterWidth[],
	availableWidth: number,
): readonly number[] {
	if (members.length === 0) return [];
	const available = Math.max(0, availableWidth);
	const natural = members.map((member) => Math.max(0, member.natural));
	const compact = members.map((member, index) => Math.min(natural[index]!, Math.max(0, member.compact)));
	const compactTotal = compact.reduce((total, width) => total + width, 0);

	if (available <= compactTotal) {
		if (compactTotal === 0) return compact;
		const scale = available / compactTotal;
		return compact.map((width) => width * scale);
	}

	const widths = [...compact];
	let remaining = available - compactTotal;
	let active = members.map((_, index) => index).filter((index) => widths[index]! < natural[index]!);
	while (remaining > 0 && active.length > 0) {
		const share = remaining / active.length;
		let spent = 0;
		const nextActive: number[] = [];
		for (const index of active) {
			const growth = Math.min(share, natural[index]! - widths[index]!);
			widths[index] = widths[index]! + growth;
			spent += growth;
			if (widths[index]! < natural[index]!) nextActive.push(index);
		}
		if (spent === 0) break;
		remaining -= spent;
		active = nextActive;
	}

	return widths;
}

export interface TeamMemberRosterProps {
	readonly members: TeamChatViewModel["members"];
	/** 负责人胶囊上额外挂一枚皇冠角标。 */
	readonly leaderMemberId?: string;
	readonly leaderLabel?: string;
	readonly memberRuntimeIds?: TeamChatViewModel["memberRuntimeIds"];
	/** 当前正在查看的成员会话；团队主视图下为空。 */
	readonly activeMemberId?: string;
	readonly onOpenMember: (memberId: string) => void;
	/** 查看成员会话时，胶囊条最左侧的「主会话」入口。 */
	readonly onBackToTeam?: () => void;
	/** 团队设置入口，挂在胶囊条最右侧。 */
	readonly onOpenSettings?: () => void;
}

/**
 * 页头标题下方的成员胶囊条：一人一枚胶囊、直接写名字，点开对应成员的独立会话。
 * 头像组挤在标题右侧时既认不出人也抢标题的位置，所以整条挪到标题下方。
 *
 * 胶囊条同时承担会话内的导航职责：最左侧的「主会话」胶囊取代了页头返回按钮，
 * 最右侧的齿轮取代了页头的团队设置按钮，让同一组上下文动作集中在一处。
 */
export function TeamMemberRoster({
	members,
	leaderMemberId,
	leaderLabel,
	memberRuntimeIds,
	activeMemberId,
	onOpenMember,
	onBackToTeam,
	onOpenSettings,
}: TeamMemberRosterProps): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	const containerRef = useRef<HTMLDivElement>(null);
	const rosterRef = useRef<HTMLDivElement>(null);
	const backButtonRef = useRef<HTMLButtonElement>(null);
	const memberButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const labelRefs = useRef(new Map<string, HTMLSpanElement>());
	const labelMinimumRefs = useRef(new Map<string, HTMLSpanElement>());
	const [labelWidths, setLabelWidths] = useState<Readonly<Record<string, number>>>({});

	useEffect(() => {
		const container = containerRef.current;
		const roster = rosterRef.current;
		if (!container || !roster) return;
		let frameId: number | null = null;

		const updateLabelWidths = () => {
			const gap = Number.parseFloat(getComputedStyle(roster).columnGap) || 0;
			const itemCount = members.length + (activeMemberId && onBackToTeam ? 1 : 0);
			const fixedWidth = members.reduce((total, member) => {
				const button = memberButtonRefs.current.get(member.id);
				const label = labelRefs.current.get(member.id);
				if (!button || !label) return total;
				return total + Math.max(0, button.getBoundingClientRect().width - label.getBoundingClientRect().width);
			}, 0);
			const backButtonWidth = activeMemberId && onBackToTeam ? (backButtonRef.current?.getBoundingClientRect().width ?? 0) : 0;
			const availableLabelWidth = Math.max(
				0,
				roster.clientWidth - fixedWidth - backButtonWidth - Math.max(0, itemCount - 1) * gap,
			);
			const measurements = members.map((member) => {
				const label = labelRefs.current.get(member.id);
				const minimum = labelMinimumRefs.current.get(member.id);
				if (!label || !minimum) return { natural: 0, compact: 0 };
				const maximum = Number.parseFloat(getComputedStyle(label).maxWidth);
				const natural = Number.isFinite(maximum) ? Math.min(label.scrollWidth, maximum) : label.scrollWidth;
				return { natural, compact: minimum.getBoundingClientRect().width };
			});
			const widths = allocateTeamMemberRosterWidths(measurements, availableLabelWidth);
			setLabelWidths(Object.fromEntries(members.map((member, index) => [member.id, widths[index] ?? 0])));
		};

		const scheduleLabelWidths = () => {
			if (frameId !== null) window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(() => {
				frameId = null;
				updateLabelWidths();
			});
		};

		scheduleLabelWidths();
		if (typeof ResizeObserver === "undefined") {
			return () => {
				if (frameId !== null) window.cancelAnimationFrame(frameId);
			};
		}
		const observer = new ResizeObserver(scheduleLabelWidths);
		observer.observe(container);
		return () => {
			observer.disconnect();
			if (frameId !== null) window.cancelAnimationFrame(frameId);
		};
	}, [activeMemberId, leaderMemberId, members, onBackToTeam, onOpenSettings]);

	if (members.length === 0) return null;

	return (
		// 左内边距与页头保持一致，胶囊条正对标题起始位置。设置按钮留在滚动区之外，
		// 成员较多时不会被横向滚动带走。
		<div
			ref={containerRef}
			data-team-member-roster="true"
			className="flex w-full min-w-0 shrink-0 items-center gap-1.5 px-3 pb-3"
		>
			<div
				ref={rosterRef}
				role="group"
				data-team-member-roster-group="true"
				aria-label={t("chat.memberSessions")}
				className="flex w-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
			>
				{activeMemberId && onBackToTeam ? (
					<button
						ref={backButtonRef}
						type="button"
						data-team-session-back="true"
						title={t("chat.backToTeam")}
						aria-label={t("chat.backToTeam")}
						className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={onBackToTeam}
					>
						<span className="icon-[solar--users-group-rounded-bold] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						<span>{t("chat.mainSession")}</span>
					</button>
				) : null}
				{members.map((member) => {
					const runtimeId = memberRuntimeIds?.[member.id];
					const active = member.id === activeMemberId;
					const streaming = member.status === "working";
					return (
						<button
							ref={(node) => {
								if (node) memberButtonRefs.current.set(member.id, node);
								else memberButtonRefs.current.delete(member.id);
							}}
							key={member.id}
							type="button"
							disabled={!runtimeId}
							data-member-session-id={member.id}
							data-member-session-active={active ? "true" : undefined}
							data-member-session-streaming={streaming ? "true" : undefined}
							aria-pressed={active}
							title={t("chat.memberSession", { name: member.name })}
							aria-label={t("chat.memberSession", { name: member.name })}
							className={cn(
								"relative flex h-7 shrink-0 items-center overflow-hidden rounded-full py-0.5 pl-1 pr-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
								active
									? "bg-primary/15 text-primary"
									: "bg-muted text-foreground hover:bg-accent",
							)}
							onClick={() => onOpenMember(member.id)}
						>
							{streaming ? (
								<span
									className="team-pill-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-full"
									aria-hidden="true"
								/>
							) : null}
							<span className="relative flex shrink-0" data-member-session-fixed="true">
								<AgentAvatarView
									name={member.name}
									avatar={member.avatar}
									active={active}
									size="md"
								/>
								{streaming ? (
									<span
										className="team-pill-live-dot absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
										aria-hidden="true"
									/>
								) : null}
							</span>
							{member.id === leaderMemberId ? (
								<span
									className="icon-[solar--crown-star-bold] relative ml-1.5 h-3.5 w-3.5 shrink-0 text-amber-400"
									title={leaderLabel}
									aria-hidden="true"
								/>
							) : null}
							<span
								ref={(node) => {
									if (node) labelRefs.current.set(member.id, node);
									else labelRefs.current.delete(member.id);
								}}
								data-member-session-label="true"
								className="relative ml-1.5 min-w-0 max-w-[9rem] shrink-0 truncate"
								style={labelWidths[member.id] === undefined ? undefined : { width: labelWidths[member.id] }}
							>
								{member.name}
							</span>
							<span
								ref={(node) => {
									if (node) labelMinimumRefs.current.set(member.id, node);
									else labelMinimumRefs.current.delete(member.id);
								}}
								aria-hidden="true"
								data-member-session-label-minimum="true"
								className="pointer-events-none invisible absolute inline-block w-[1ch]"
							/>
						</button>
					);
				})}
			</div>
			{onOpenSettings ? (
				<button
					type="button"
					data-team-settings="true"
					title={t("chat.configure")}
					aria-label={t("chat.configure")}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onClick={onOpenSettings}
				>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}
