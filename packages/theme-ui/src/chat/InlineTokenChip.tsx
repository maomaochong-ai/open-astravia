import type { MouseEventHandler, ReactNode } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface InlineTokenChipProps {
	readonly icon?: string;
	readonly iconUrl?: string;
	readonly iconNode?: ReactNode;
	readonly label: string;
	readonly title?: string;
	readonly tone?: "primary" | "member";
	readonly className?: string;
	readonly asButton?: boolean;
	readonly onClick?: MouseEventHandler<HTMLButtonElement>;
}

/** Shared read/write representation for inline composer and user-message tokens. */
export function InlineTokenChip({
	icon,
	iconUrl,
	iconNode,
	label,
	title,
	tone = "primary",
	className,
	asButton = false,
	onClick,
}: InlineTokenChipProps): JSX.Element {
	const classes = cn(
		"mx-px inline-block max-w-full select-none whitespace-pre rounded-md border px-1.5 align-baseline text-[12px] font-medium leading-[1.6]",
		tone === "member"
			? "border-sky-400/30 bg-sky-400/10 text-sky-200"
			: "border-primary/25 bg-primary/10 text-primary",
		asButton && "cursor-pointer hover:bg-primary/20",
		className,
	);
	const content = (
		<>
			{iconNode ? (
				<span className="mr-1 inline-flex h-3 w-3 items-center justify-center overflow-hidden align-[-0.15em]">
					{iconNode}
				</span>
			) : iconUrl ? (
				<img
					src={iconUrl}
					alt=""
					draggable={false}
					className="mr-1 inline-block h-3 w-3 rounded-sm align-[-0.15em] object-contain"
				/>
			) : icon ? (
				<span className={`${icon} mr-1 inline-block h-3 w-3 align-[-0.15em]`} />
			) : null}
			{label}
		</>
	);

	return asButton ? (
		<button type="button" className={classes} title={title ?? label} onClick={onClick} data-inline-token="true">
			{content}
		</button>
	) : (
		<span className={classes} title={title ?? label} data-inline-token="true">
			{content}
		</span>
	);
}
