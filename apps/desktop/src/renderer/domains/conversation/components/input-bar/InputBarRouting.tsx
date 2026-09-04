import { Button } from "@shared/components/ui/button";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import type { InputBarModel } from "./types";

export function InputBarRouting({ model }: { readonly model: NonNullable<InputBarModel["routing"]> }): JSX.Element {
	const activeParticipants = model.participants.filter(
		(participant) => participant.status !== "idle" && participant.statusLabel,
	);
	const hasError = activeParticipants.some((participant) => participant.status === "error");

	return (
		<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-2 no-scrollbar">
			{model.participants.map((participant) => (
				<RoutingButton
					key={participant.id}
					selected={participant.selected}
					label={participant.name}
					badgeLabel={participant.badgeLabel}
					statusLabel={participant.statusLabel}
					onClick={participant.onSelect}
				>
					<span className="relative flex h-7 min-w-7 items-center justify-center">
						<span className="group/member-avatar relative rounded-full">
							<AgentAvatarView
								name={participant.name}
								avatar={participant.avatar}
								blueprintId={participant.blueprintId}
								active={participant.selected}
							/>
							<span
								className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-sm font-semibold text-white opacity-0 transition-opacity duration-150 group-hover/member-avatar:opacity-100"
								aria-hidden="true"
							>
								@
							</span>
							{participant.status !== "idle" ? (
								<span
									className={[
										"absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-input-bar-bg",
										participant.status === "error"
											? "bg-destructive"
											: "animate-pulse bg-primary ring-2 ring-primary/30",
									].join(" ")}
									aria-hidden="true"
								/>
							) : null}
						</span>
						{participant.badgeLabel ? (
							<span
								className="pointer-events-none absolute -bottom-2 left-1/2 z-10 max-w-16 -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-primary px-1 py-0.5 text-[10px] font-medium leading-none text-primary-foreground"
							>
								{participant.badgeLabel}
							</span>
						) : null}
					</span>
				</RoutingButton>
			))}
			{model.showStatusSummary !== false && activeParticipants.length > 0 ? (
				<div
					role="status"
					aria-live="polite"
					className="ml-1 flex min-w-0 items-center gap-1.5 border-l border-border/50 pl-2 text-xs"
				>
					<span
						className={[
							"h-2 w-2 shrink-0 rounded-full",
							hasError ? "bg-destructive" : "animate-pulse bg-primary",
						].join(" ")}
						aria-hidden="true"
					/>
					<span className={hasError ? "truncate text-destructive" : "truncate text-primary"}>
						{activeParticipants.map((participant) => `${participant.name} · ${participant.statusLabel}`).join("、")}
					</span>
				</div>
			) : null}
		</div>
	);
}

function RoutingButton({
	selected,
	label,
	badgeLabel,
	statusLabel,
	onClick,
	children,
}: {
	readonly selected: boolean;
	readonly label: string;
	readonly badgeLabel?: string;
	readonly statusLabel?: string;
	readonly onClick: () => void;
	readonly children: JSX.Element;
}): JSX.Element {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={[label, badgeLabel, statusLabel].filter(Boolean).join(" · ")}
			aria-pressed={selected}
			data-selected={selected}
			title={[label, badgeLabel].filter(Boolean).join(" · ")}
			className="h-auto min-w-12 rounded-lg px-1 py-2 data-[selected=true]:bg-primary/15 data-[selected=true]:text-foreground data-[selected=true]:hover:bg-primary/15 data-[selected=true]:hover:text-foreground"
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
