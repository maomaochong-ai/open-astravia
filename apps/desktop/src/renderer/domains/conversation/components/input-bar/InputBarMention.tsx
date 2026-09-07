import { Popover, PopoverContent, PopoverTrigger } from "@shared/components/ui/popover";
import { cn } from "@shared/lib/utils";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { useState } from "react";
import type { InputBarModel } from "./types";

type MentionModel = NonNullable<InputBarModel["routing"]>;
type MentionParticipant = MentionModel["participants"][number];

/** 胶囊里最多摞几个头像，多出来的折成 +N。 */
const MAX_CAPSULE_AVATARS = 3;

export interface InputBarMentionProps {
	readonly model: MentionModel;
	readonly disabled?: boolean;
	readonly visible?: boolean;
}

/**
 * 工具栏左下角的「@ 指定成员」入口：没选人时是一枚 @ 图标，选过之后就地变成
 * 头像（组）胶囊，两种形态共用同一个面板，既能继续 @ 也能取消 @。
 */
export function InputBarMention({
	model,
	disabled = false,
	visible = true,
}: InputBarMentionProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const selected = model.participants.filter((participant) => participant.selected);
	const shown = selected.slice(0, MAX_CAPSULE_AVATARS);
	const overflow = selected.length - shown.length;
	const hasSelection = selected.length > 0;
	// 单选直呼其名，多选折成「N 个成员」，胶囊宽度才不会被长名字撑爆。
	const capsuleText = hasSelection
		? selected.length === 1
			? (selected[0]?.name ?? "")
			: model.labels.selected(selected.length)
		: "";
	const label = hasSelection ? capsuleText : model.labels.trigger;

	return (
		<span
			data-command-panel-keep-open="true"
			className={visible ? "flex shrink-0 items-center" : "hidden"}
		>
			<Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={disabled}
						title={label}
						aria-label={label}
						aria-expanded={open}
						className={cn(
							// 图标 ⇄ 胶囊的形变全部交给 CSS 过渡：这枚按钮常驻输入栏，
							// 用 JS 动画等于每次输入都要跑一遍动画状态机。
							"no-drag flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-full transition-[background-color,color,padding,border-radius] duration-200 ease-out disabled:pointer-events-none disabled:opacity-30",
							hasSelection ? "gap-1 px-1.5" : "gap-0 rounded-lg px-[5px]",
							open || hasSelection
								? "bg-primary/10 text-primary"
								: "text-foreground hover:bg-accent/60",
						)}
					>
						<span
							className={cn(
								"icon-[solar--mention-circle-linear] h-[17px] shrink-0 transition-[width,opacity,transform] duration-200 ease-out",
								hasSelection ? "w-0 scale-50 opacity-0" : "w-[17px] scale-100 opacity-100",
							)}
							aria-hidden="true"
						/>
						<span
							className={cn(
								"flex min-w-0 items-center gap-1 transition-[max-width,opacity] duration-200 ease-out",
								hasSelection ? "max-w-[168px] opacity-100" : "max-w-0 opacity-0",
							)}
						>
							<span className="flex shrink-0 items-center">
								{shown.map((participant, index) => (
									<span
										key={participant.id}
										className={cn("relative flex", index > 0 && "-ml-1.5")}
									>
										<AgentAvatarView
											name={participant.name}
											avatar={participant.avatar}
											blueprintId={participant.blueprintId}
											seed={participant.id}
											size="sm"
											active
											className="ring-2 ring-input-bar-bg"
										/>
										<MentionStatusDot status={participant.status} compact />
									</span>
								))}
							</span>
							{overflow > 0 ? (
								<span className="shrink-0 text-[10px] font-semibold leading-none">+{overflow}</span>
							) : null}
							<span className="truncate text-[11px] font-medium leading-none">{capsuleText}</span>
						</span>
					</button>
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="start"
					sideOffset={8}
					className="w-[268px] gap-0 overflow-hidden rounded-xl border border-border p-0 shadow-lg"
				>
					<div className="flex items-baseline justify-between gap-2 border-b border-border/60 px-3 py-2">
						<span className="text-[12px] font-medium text-foreground">{model.labels.title}</span>
						{hasSelection ? (
							<button
								type="button"
								className="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
								onClick={() => {
									for (const participant of selected) participant.onSelect();
								}}
							>
								{model.labels.clear}
							</button>
						) : null}
					</div>
					{model.participants.length === 0 ? (
						<p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
							{model.labels.empty}
						</p>
					) : (
						<div className="max-h-[264px] overflow-y-auto p-1.5 no-scrollbar">
							{model.participants.map((participant) => (
								<MentionRow key={participant.id} participant={participant} />
							))}
						</div>
					)}
					<p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
						{model.labels.hint}
					</p>
				</PopoverContent>
			</Popover>
		</span>
	);
}

function MentionRow({ participant }: { readonly participant: MentionParticipant }): JSX.Element {
	return (
		<button
			type="button"
			aria-pressed={participant.selected}
			data-selected={participant.selected}
			className={cn(
				"group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
				participant.selected ? "bg-primary/10" : "hover:bg-accent/70",
			)}
			onClick={participant.onSelect}
		>
			<span className="relative flex shrink-0">
				<AgentAvatarView
					name={participant.name}
					avatar={participant.avatar}
					blueprintId={participant.blueprintId}
					seed={participant.id}
					active={participant.selected}
					size="lg"
				/>
				<MentionStatusDot status={participant.status} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-[12.5px] font-medium text-foreground">{participant.name}</span>
					{participant.badgeLabel ? (
						<span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] leading-[15px] text-muted-foreground">
							{participant.badgeLabel}
						</span>
					) : null}
				</span>
				{participant.statusLabel ? (
					<span
						className={cn(
							"truncate text-[11px]",
							participant.status === "error" ? "text-destructive" : "text-primary",
						)}
					>
						{participant.statusLabel}
					</span>
				) : null}
			</span>
			<span
				className={cn(
					"shrink-0",
					participant.selected
						? "icon-[solar--check-circle-bold] h-4 w-4 text-primary"
						: "icon-[solar--add-circle-linear] h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
				)}
				aria-hidden="true"
			/>
		</button>
	);
}

function MentionStatusDot({
	status,
	compact = false,
}: {
	readonly status: MentionParticipant["status"];
	readonly compact?: boolean;
}): JSX.Element | null {
	if (status === "idle") return null;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"absolute -right-0.5 -top-0.5 rounded-full border border-input-bar-bg",
				compact ? "h-1.5 w-1.5" : "h-2 w-2",
				status === "error" ? "bg-destructive" : "animate-pulse bg-primary",
			)}
		/>
	);
}
