import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

export interface AvatarStackViewProps {
	readonly avatarUrls: readonly string[];
	readonly className?: string;
}

const MAX_VISIBLE_AVATARS = 3;

/** Compact, decorative avatar stack for places where the adjacent label names the group. */
export function AvatarStackView({
	avatarUrls,
	className,
}: AvatarStackViewProps): JSX.Element {
	const visibleAvatarUrls = avatarUrls.slice(0, MAX_VISIBLE_AVATARS);
	const hiddenAvatarCount = avatarUrls.length - visibleAvatarUrls.length;
	return (
		<span
			className={cn("inline-flex shrink-0 items-center pl-0.5", className)}
			aria-hidden="true"
			data-avatar-stack="true"
		>
			{visibleAvatarUrls.map((avatarUrl, index) => (
				<span
					key={`${avatarUrl}:${index}`}
					className={cn(
						"relative h-4 w-4 shrink-0 rounded-full ring-1 ring-border",
						index > 0 && "-ml-1.5",
					)}
				>
					<img src={avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
					{index === MAX_VISIBLE_AVATARS - 1 && hiddenAvatarCount > 0 ? (
						<span
							className="absolute inset-0 inline-flex items-center justify-center rounded-full bg-background/60 text-[9px] tabular-nums text-foreground"
							data-avatar-overflow={hiddenAvatarCount}
						>
							+{hiddenAvatarCount}
						</span>
					) : null}
				</span>
			))}
		</span>
	);
}
