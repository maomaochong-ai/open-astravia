import { Button } from "@shared/components/ui/button";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import type { InputBarModel } from "./types";

export function InputBarRouting({ model }: { readonly model: NonNullable<InputBarModel["routing"]> }): JSX.Element {
	return (
		<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-2 no-scrollbar">
			<RoutingButton selected={model.leaderSelected} label={model.leaderLabel} onClick={model.onSelectLeader}>
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-border">
					<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
				</span>
			</RoutingButton>
			{model.participants.map((participant) => (
				<RoutingButton
					key={participant.id}
					selected={participant.selected}
					label={participant.name}
					onClick={participant.onSelect}
				>
					<span className="relative">
						<AgentAvatarView
							name={participant.name}
							avatar={participant.avatar}
							blueprintId={participant.blueprintId}
							active={participant.selected}
						/>
						{participant.status !== "idle" ? (
							<span
								className={[
									"absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-input-bar-bg",
									participant.status === "error" ? "bg-destructive" : "animate-pulse bg-primary",
								].join(" ")}
							/>
						) : null}
					</span>
				</RoutingButton>
			))}
		</div>
	);
}

function RoutingButton({
	selected,
	label,
	onClick,
	children,
}: {
	readonly selected: boolean;
	readonly label: string;
	readonly onClick: () => void;
	readonly children: JSX.Element;
}): JSX.Element {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			aria-label={label}
			aria-pressed={selected}
			title={label}
			className={selected ? "rounded-full bg-primary/15" : "rounded-full"}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}
