import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import type { JSX, ReactNode } from "react";

export interface ConversationComposerToolbarViewProps {
	readonly left?: ReactNode;
	readonly right: ReactNode;
	readonly className?: string;
}

/** Shared single-line composer toolbar layout. Hosts provide only domain-specific controls. */
export function ConversationComposerToolbarView({
	left,
	right,
	className,
}: ConversationComposerToolbarViewProps): JSX.Element {
	const leftSurface = useThemeSurface("chat.inputBarToolbarLeft");
	const rightSurface = useThemeSurface("chat.inputBarToolbarRight");
	return (
		<div
			className={[
				"flex flex-nowrap items-center justify-between gap-x-1.5 px-2 pb-2 pt-1 sm:px-2.5",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div
				className={["flex min-w-0 shrink items-center gap-0.5", leftSurface?.rootClassName]
					.filter(Boolean)
					.join(" ")}
				data-theme-surface-root="chat.inputBarToolbarLeft"
			>
				{left}
			</div>
			<div
				className={[
					"ml-auto flex min-w-0 shrink items-center gap-1",
					rightSurface?.rootClassName,
				]
					.filter(Boolean)
					.join(" ")}
				data-theme-surface-root="chat.inputBarToolbarRight"
			>
				{right}
			</div>
		</div>
	);
}
