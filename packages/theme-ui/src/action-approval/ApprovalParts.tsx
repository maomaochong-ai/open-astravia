import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { cn } from "./cn";

/** 与 batch-tasks / scheduler 审批 UI 一致的信息行 */
export function ApprovalValueRow({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}): JSX.Element {
	return (
		<div className="flex items-start justify-between gap-4 py-1.5">
			<span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
			<span
				className={cn(
					"min-w-0 break-words text-right text-[11px] font-medium text-foreground",
					mono && "break-all font-mono text-[10px]",
				)}
			>
				{value}
			</span>
		</div>
	);
}

export function ApprovalValueList({
	rows,
}: {
	rows: ReadonlyArray<{ label: string; value: string; mono?: boolean }>;
}): JSX.Element {
	return (
		<div className="rounded-lg border border-border/50 bg-background/50 px-3">
			{rows.map((row, index) => (
				<div key={`${row.label}-${index}`}>
					{index > 0 && <div className="h-px bg-border/40" />}
					<ApprovalValueRow label={row.label} value={row.value} mono={row.mono} />
				</div>
			))}
		</div>
	);
}

/** 目标实体卡片（对齐 BatchTasksTaskApproval / Scheduler dialog） */
export function ApprovalTargetCard({
	icon,
	title,
	subtitle,
	badge,
	rows,
	subtitleMono = true,
}: {
	icon: string;
	title: string;
	subtitle?: string;
	badge?: string;
	rows?: ReadonlyArray<{ label: string; value: string; mono?: boolean }>;
	/** 副标题是否 monospaced；文件名/URL 可读时建议 false */
	subtitleMono?: boolean;
}): JSX.Element {
	return (
		<div className="rounded-lg border border-border/50 bg-background/50 p-3">
			<div className="flex items-start gap-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
					<span className={`${icon} h-4 w-4 text-muted-foreground`} />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[12px] font-semibold text-foreground">{title}</div>
					{subtitle && (
						<div
							className={cn(
								"mt-0.5 break-all text-[10px] text-muted-foreground",
								subtitleMono && "font-mono",
							)}
						>
							{subtitle}
						</div>
					)}
				</div>
				{badge && (
					<span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
						{badge}
					</span>
				)}
			</div>
			{rows && rows.length > 0 && (
				<div className="mt-3 space-y-0 border-t border-border/40 pt-1">
					{rows.map((row) => (
						<ApprovalValueRow key={row.label} label={row.label} value={row.value} mono={row.mono} />
					))}
				</div>
			)}
		</div>
	);
}

/** 「执行后会发生什么」说明卡 */
export function ApprovalImpactCard({
	icon,
	title,
	description,
	destructive,
}: {
	icon: string;
	title: string;
	description: string;
	destructive?: boolean;
}): JSX.Element {
	return (
		<div
			className={cn(
				"rounded-lg border p-3",
				destructive ? "border-destructive/30 bg-destructive/10" : "border-primary/20 bg-primary/5",
			)}
		>
			<div className="flex gap-2">
				<span
					className={cn(
						`${icon} mt-0.5 h-4 w-4 shrink-0`,
						destructive ? "text-destructive" : "text-primary",
					)}
				/>
				<div>
					<div className="text-[11px] font-semibold text-foreground">{title}</div>
					<p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
				</div>
			</div>
		</div>
	);
}

export function ApprovalWarningCard({ children }: { children: ReactNode }): JSX.Element {
	return (
		<div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
			<span className="icon-[mdi--alert-outline] mt-0.5 h-4 w-4 shrink-0" />
			<p className="text-[11px] leading-5">{children}</p>
		</div>
	);
}

export function ApprovalFormField({
	id,
	label,
	hint,
	children,
}: {
	id: string;
	label: string;
	hint?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="rounded-lg border border-border/50 bg-background/50 p-3">
			<label className="mb-1.5 block text-[11px] font-medium text-muted-foreground" htmlFor={id}>
				{label}
			</label>
			{children}
			{hint && <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{hint}</p>}
		</div>
	);
}

/**
 * 设置页风格的分组容器：建立「这一组设置」的层级感。
 * 对齐 settings `SettingSection` 的卡片结构。
 */
export function ApprovalSettingGroup({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="space-y-2">
			<div>
				<div className="text-[13px] font-semibold text-foreground">{title}</div>
				{description && <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</p>}
			</div>
			<div className="@container overflow-hidden rounded-xl border border-border bg-muted/40">{children}</div>
		</div>
	);
}

/**
 * 设置页风格的一行：左侧标题/说明，右侧控件。
 * 对齐 settings `SettingRow`。
 */
export function ApprovalSettingRow({
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
		<div
			className={cn(
				"flex items-center justify-between gap-4 px-4 py-3",
				border && "border-b border-border/60",
			)}
		>
			<div className="min-w-0 flex-1">
				<div className="text-[13px] font-medium text-foreground">{title}</div>
				{description && <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</div>}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

/** Lightweight switch (no radix) — visual match for approval toggle intent card. */
function ApprovalSwitch({
	checked,
	onCheckedChange,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				"peer relative inline-flex h-[18.4px] w-[32px] shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring",
				checked ? "bg-primary" : "bg-input",
			)}
		>
			<span
				className={cn(
					"pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform",
					checked ? "translate-x-[calc(100%-2px)]" : "translate-x-0",
				)}
			/>
		</button>
	);
}

/**
 * 开/关意图主卡：消除「启用/停用」歧义。
 * - 大字明确「将改为：开启/关闭」
 * - 右侧 Switch 可改（确认前可纠正 AI 提议）
 * - 目标实体名称单独展示
 */
export function ApprovalToggleIntentCard({
	targetIcon,
	targetTitle,
	targetSubtitle,
	enabled,
	onEnabledChange,
	willBecomeLabel,
	stateOnLabel,
	stateOffLabel,
	stateHint,
	editableHint,
}: {
	targetIcon: string;
	targetTitle: string;
	targetSubtitle?: string;
	/** 确认后的目标状态（true=开启） */
	enabled: boolean;
	onEnabledChange?: (enabled: boolean) => void;
	willBecomeLabel: string;
	stateOnLabel: string;
	stateOffLabel: string;
	stateHint: string;
	editableHint?: string;
}): JSX.Element {
	const stateLabel = enabled ? stateOnLabel : stateOffLabel;
	const interactive = typeof onEnabledChange === "function";

	return (
		<div className="space-y-3">
			<div className="rounded-lg border border-border/50 bg-background/50 p-3">
				<div className="flex items-start gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
						<span className={`${targetIcon} h-5 w-5 text-muted-foreground`} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[11px] text-muted-foreground">{willBecomeLabel}</div>
						<div
							className={cn(
								"mt-0.5 text-[18px] font-semibold tracking-tight",
								enabled ? "text-primary" : "text-foreground",
							)}
						>
							{stateLabel}
						</div>
						<p className="mt-1 text-[11px] leading-5 text-muted-foreground">{stateHint}</p>
					</div>
					{interactive ? (
						<div className="flex flex-col items-end gap-1">
							<ApprovalSwitch checked={enabled} onCheckedChange={onEnabledChange} />
							{editableHint && (
								<span className="max-w-[7rem] text-right text-[9px] leading-3 text-muted-foreground">
									{editableHint}
								</span>
							)}
						</div>
					) : (
						<span
							className={cn(
								"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
								enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
							)}
						>
							{stateLabel}
						</span>
					)}
				</div>
			</div>
			<div className="rounded-lg border border-border/50 bg-background/50 p-3">
				<div className="flex items-center gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
						<span className={`${targetIcon} h-4 w-4 text-muted-foreground`} />
					</div>
					<div className="min-w-0">
						<div className="truncate text-[12px] font-semibold text-foreground">{targetTitle}</div>
						{targetSubtitle && (
							<div className="mt-0.5 truncate text-[10px] text-muted-foreground">{targetSubtitle}</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export interface ApprovalRawFallbackLabels {
	readonly unreadableRequest: string;
	readonly showTechnicalDetails: string;
	readonly hideTechnicalDetails: string;
}

/** 解析失败或仅调试时：主路径说明 + 可折叠技术详情（默认收起）。 */
export function ApprovalRawFallback({
	input,
	message,
	labels,
}: {
	input: unknown;
	message?: string;
	labels: ApprovalRawFallbackLabels;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<div className="space-y-2">
			<p className="text-[11px] leading-5 text-muted-foreground">
				{message ?? labels.unreadableRequest}
			</p>
			<button
				type="button"
				className="text-[11px] font-medium text-primary hover:underline"
				onClick={() => setOpen((value) => !value)}
			>
				{open ? labels.hideTechnicalDetails : labels.showTechnicalDetails}
			</button>
			{open && (
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-[10px] leading-4 text-foreground">
					{JSON.stringify(input, null, 2)}
				</pre>
			)}
		</div>
	);
}
