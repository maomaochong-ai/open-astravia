import type { JSX, ReactNode } from "react";
import { cn } from "@vetta/ui";

/** Minimal section meta used by settings chrome (desktop registry satisfies this). */
export interface SettingSectionMeta {
	readonly id: string;
	readonly title?: string;
	readonly titleKey?: string;
}

export function SettingRow({
	title,
	description,
	children,
	border = true,
}: {
	title: string;
	description?: string;
	children: ReactNode;
	border?: boolean;
}): JSX.Element {
	return (
		<div className={cn("flex items-center justify-between gap-6 px-5 py-4", border && "border-b border-border")}>
			<div className="min-w-0 flex-1 basis-0">
				<div className="truncate text-[13px] font-medium text-foreground" title={title}>
					{title}
				</div>
				{description && (
					<div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground" title={description}>
						{description}
					</div>
				)}
			</div>
			<div className="max-w-[min(100%,24rem)] shrink-0">{children}</div>
		</div>
	);
}

export function SettingSection({
	section,
	title,
	description,
	children,
	t,
}: {
	section: SettingSectionMeta;
	title?: ReactNode;
	description?: string;
	children: ReactNode;
	t?: (key: string) => string;
}): JSX.Element {
	const renderedTitle = title !== undefined ? title : t && section.titleKey ? t(section.titleKey) : section.title;
	const hasTitle =
		renderedTitle != null &&
		renderedTitle !== false &&
		!(typeof renderedTitle === "string" && renderedTitle.trim() === "");
	return (
		<div className="mb-6 p-1.5" data-setting-section-highlight-target={section.id}>
			{hasTitle &&
				(typeof renderedTitle === "string" ? (
					<h2
						id={section.id}
						className={cn("text-[15px] font-semibold text-foreground", description ? "mb-1" : "mb-3")}
					>
						{renderedTitle}
					</h2>
				) : (
					<div
						id={section.id}
						className={cn("text-[15px] font-semibold text-foreground", description ? "mb-1" : "mb-3")}
					>
						{renderedTitle}
					</div>
				))}
			{description && <p className="mb-3 text-[12px] text-muted-foreground">{description}</p>}
			<div
				id={hasTitle ? undefined : section.id}
				className="overflow-hidden rounded-xl border border-border bg-card"
				data-setting-section-id={section.id}
			>
				{children}
			</div>
		</div>
	);
}

export function SettingHeading({
	section,
	title,
	className,
	t,
}: {
	section: SettingSectionMeta;
	title?: ReactNode;
	className?: string;
	t?: (key: string) => string;
}): JSX.Element {
	const renderedTitle = title ?? (t && section.titleKey ? t(section.titleKey) : section.title);
	return (
		<h2 id={section.id} className={cn("text-[15px] font-semibold text-foreground", className)}>
			{renderedTitle}
		</h2>
	);
}
