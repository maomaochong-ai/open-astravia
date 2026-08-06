import type { JSX, ReactNode } from "react";

export interface SettingsPageShellViewProps {
	readonly title: string;
	readonly description?: string;
	readonly headerAction?: ReactNode;
	readonly loading?: boolean;
	readonly loadingLabel?: string;
	readonly children?: ReactNode;
	readonly footer?: ReactNode;
	readonly pb?: boolean;
}

/** Shared settings tab page chrome (title / description / optional header action). */
export function SettingsPageShellView({
	title,
	description,
	headerAction,
	loading = false,
	loadingLabel,
	children,
	footer,
	pb = false,
}: SettingsPageShellViewProps): JSX.Element {
	if (loading) {
		return (
			<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
				{description ? (
					<>
						<h1 className="mb-2 text-[20px] font-bold text-foreground">{title}</h1>
						{description && <p className="mb-6 text-[12px] text-muted-foreground">{description}</p>}
					</>
				) : (
					<h1 className="mb-6 text-[20px] font-bold text-foreground">{title}</h1>
				)}
				<div className="flex items-center justify-center py-16">
					<span className="text-[13px] text-muted-foreground">{loadingLabel}</span>
				</div>
			</div>
		);
	}

	return (
		<div className={`mx-auto w-full max-w-[680px] px-8 pt-2 pb-4${pb ? " pb-10" : ""}`}>
			<div className="mb-6">
				<div
					className={
						headerAction
							? "mb-1 flex flex-wrap items-center justify-between gap-3"
							: description
								? "mb-1.5"
								: "mb-6 flex flex-wrap items-center justify-between gap-3"
					}
				>
					{headerAction ? (
						<>
							<h1 className="text-[20px] font-bold text-foreground">{title}</h1>
							{headerAction}
						</>
					) : description ? (
						<h1 className="text-[20px] font-bold text-foreground">{title}</h1>
					) : (
						<>
							<h1 className="text-[20px] font-bold text-foreground">{title}</h1>
						</>
					)}
				</div>
				{description && (
					<p
						className={
							description.includes("\n")
								? "text-[12px] leading-relaxed text-muted-foreground"
								: "text-[12px] text-muted-foreground"
						}
					>
						{description}
					</p>
				)}
			</div>
			{children}
			{footer}
		</div>
	);
}
