import { Button, cn } from "@vetta-org/ui";
import { type FormEvent, type JSX, type ReactNode, useState } from "react";

export type PortForwardViewStatus = "active" | "reconnecting" | "failed";

/** 一条已经建立的转发（映射）。 */
export interface PortForwardViewItem {
	readonly localPort: number;
	/** 用户要复制或打开的那个地址，例如 `localhost:3000`。 */
	readonly localAddress: string;
	readonly status: PortForwardViewStatus;
	/** status 为 failed 时的技术原因，原样来自 ssh。 */
	readonly error?: string;
}

/**
 * 列表里的一行：远端的一个端口，连同占着它的进程与它的映射状态。
 *
 * 在跑的服务与已建立的映射合成一行，而不是分两块列：用户关心的是「那个服务」，映射只是
 * 它的一个状态。分开列的话同一个 3000 会在上下两处各出现一次。
 */
export interface PortRowViewItem {
	readonly port: number;
	readonly processName?: string;
	/** 完整命令行，两个都叫 `node` 的进程靠它分清。 */
	readonly command?: string;
	readonly pid?: number;
	/** 进程启动了多久，例如「3 分钟前」。 */
	readonly startedLabel?: string;
	/** 悬停时给出的完整启动时间。 */
	readonly startedTitle?: string;
	/** 绑在所有网卡上：远端网络里的其他机器也连得到它。 */
	readonly publicBind: boolean;
	/** 来自后台任务输出——用户刚起的那个服务。 */
	readonly fromOutput: boolean;
	/** 系统端口（特权端口或这条连接的 sshd）：单独折叠、置灰、不给终止。 */
	readonly sensitive: boolean;
	/** 临时端口（32768 以上且不是用户刚起的）：默认折叠。 */
	readonly ephemeral: boolean;
	/** false 表示上一次扫描时远端这个端口已经没人在听了（映射还在，但指向空处）。 */
	readonly listening?: boolean;
	readonly forward?: PortForwardViewItem;
	/** 知道 pid 且不是系统端口时才能终止。 */
	readonly killable: boolean;
	/** 上一次 SIGTERM 没把它收掉，这次该给 SIGKILL。 */
	readonly needsForceKill: boolean;
}

/** 扫描远端端口的结果。`unsupported` 是远端没有可用的扫描工具。 */
export type PortScanState = "loading" | "ready" | "unsupported" | "failed";

export interface PortsTabPanelViewLabels {
	readonly heading: string;
	/** 标题下的两枚统计，例如「12 运行中」「1 已映射」。 */
	readonly runningStat: (count: number) => string;
	readonly forwardedStat: (count: number) => string;
	/** 列表的两段标题。 */
	readonly sectionForwarded: string;
	readonly sectionRunning: string;
	/** 手动映射卡片的标题与两个输入框的标签。 */
	readonly manualTitle: string;
	readonly remotePortLabel: string;
	readonly localPortLabel: string;
	readonly empty: string;
	readonly emptyHint: string;
	readonly remotePortPlaceholder: string;
	readonly localPortPlaceholder: string;
	readonly localPortPrefix: string;
	readonly add: string;
	/** 展开手动填端口那一行的按钮。 */
	readonly addManual: string;
	readonly forward: string;
	readonly preview: string;
	readonly openExternal: string;
	readonly copyAddress: string;
	readonly copied: string;
	readonly changeLocalPort: string;
	readonly save: string;
	readonly cancel: string;
	readonly stop: string;
	readonly retry: string;
	readonly refresh: string;
	readonly statusActive: string;
	readonly statusReconnecting: string;
	readonly statusFailed: string;
	readonly scanUnsupported: string;
	readonly scanFailed: string;
	readonly fromOutput: string;
	readonly notListening: string;
	readonly publicBind: string;
	readonly terminate: string;
	readonly forceTerminate: string;
	readonly terminateConfirm: (name: string) => string;
	readonly sensitiveToggle: (count: number) => string;
	readonly sensitiveHint: string;
	readonly unnamedToggle: (count: number) => string;
	readonly unnamedHint: string;
	/** 折叠起来的临时端口那一行；数量只有视图知道，所以这条是函数而不是成品字符串。 */
	readonly ephemeralToggle: (count: number) => string;
}

export interface PortsTabPanelViewProps {
	/** 已按启动时间从新到旧排好。 */
	readonly rows: readonly PortRowViewItem[];
	readonly scanState: PortScanState;
	/** scanState 为 failed 时的原因。 */
	readonly scanError?: string;
	readonly labels: PortsTabPanelViewLabels;
	/** 手动表单：远端端口号。 */
	readonly draftRemotePort: string;
	/** 手动表单：本机端口号，留空表示与远端同号。 */
	readonly draftLocalPort: string;
	/** 最近一次操作的失败原因，例如本机端口已被占用。 */
	readonly errorMessage?: string;
	/** 刚复制过地址的那一行的端口号。 */
	readonly copiedPort?: number;
	/** 正在改本机端口的那一行的端口号。 */
	readonly editingRemotePort?: number;
	readonly editingLocalPort: string;
	/** 正在终止的那一行：等远端确认进程退出。 */
	readonly terminatingPort?: number;
	readonly onDraftRemotePortChange: (value: string) => void;
	readonly onDraftLocalPortChange: (value: string) => void;
	readonly onAddDraftPort: (event: FormEvent) => void;
	readonly onForward: (port: number) => void;
	readonly onPreview: (port: number) => void;
	readonly onOpenExternal: (port: number) => void;
	readonly onCopyAddress: (port: number) => void;
	readonly onStartEditLocalPort: (port: number) => void;
	readonly onEditingLocalPortChange: (value: string) => void;
	readonly onSubmitLocalPort: (event: FormEvent) => void;
	readonly onCancelEditLocalPort: () => void;
	readonly onStop: (port: number) => void;
	readonly onRetry: (port: number) => void;
	readonly onTerminate: (port: number) => void;
	readonly onRefresh: () => void;
}

const CHIP_TONE: Record<PortForwardViewStatus, string> = {
	active: "bg-primary/10 text-primary hover:bg-primary/15",
	reconnecting: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400",
	failed: "bg-destructive/10 text-destructive hover:bg-destructive/15",
};

const CHIP_DOT: Record<PortForwardViewStatus, string> = {
	active: "bg-emerald-500",
	reconnecting: "bg-amber-500 animate-pulse",
	failed: "bg-destructive",
};

/** 骨架屏里占位的端口徽标。 */
const PORT_COLUMN = "w-10 shrink-0";

function IconButton({
	icon,
	title,
	onClick,
	tone = "default",
}: {
	icon: string;
	title: string;
	onClick: () => void;
	tone?: "default" | "danger";
}): JSX.Element {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			title={title}
			aria-label={title}
			onClick={onClick}
			className={cn(
				"shrink-0 text-muted-foreground",
				tone === "danger" ? "hover:bg-destructive/10 hover:text-destructive" : "hover:text-foreground",
			)}
		>
			<span aria-hidden className={`${icon} h-3.5 w-3.5`} />
		</Button>
	);
}

/**
 * 端口号输入框：面板里出现三次（改本机端口、手动映射两个），视觉必须是同一个。
 *
 * 实底而不是描边：这一页没有线条，输入框靠一块比面板亮一档的底色立住。
 */
function PortInput({
	id,
	value,
	label,
	placeholder,
	className,
	size = "md",
	showLabel = false,
	onChange,
}: {
	id: string;
	value: string;
	label: string;
	placeholder: string;
	className: string;
	size?: "sm" | "md";
	/** 为真时标签显示在输入框上方，否则只给读屏。 */
	showLabel?: boolean;
	onChange: (value: string) => void;
}): JSX.Element {
	const input = (
		<input
			id={id}
			type="text"
			inputMode="numeric"
			value={value}
			spellCheck={false}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
			className={cn(
				"w-full rounded-lg bg-foreground/[0.07] px-3 font-mono text-foreground tabular-nums outline-none ring-primary/40 transition-[box-shadow,background-color] placeholder:font-sans placeholder:text-muted-foreground/50 hover:bg-foreground/[0.09] focus:bg-foreground/[0.09] focus:ring-2",
				size === "md" ? "h-9 text-[13px] placeholder:text-[12px]" : "h-8 text-[12px] placeholder:text-[11px]",
			)}
		/>
	);
	if (showLabel) {
		return (
			<label htmlFor={id} className={cn("flex flex-col gap-1.5", className)}>
				<span className="px-0.5 text-[11px] text-muted-foreground">{label}</span>
				{input}
			</label>
		);
	}
	return (
		<span className={className}>
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			{input}
		</span>
	);
}

/** 映射状态那枚胶囊：点它就是这一行最常见的意图——打开（断开时则是重试）。 */
function ForwardChip({
	forward,
	labels,
	copied,
	onPreview,
	onRetry,
}: {
	forward: PortForwardViewItem;
	labels: PortsTabPanelViewLabels;
	copied: boolean;
	onPreview: () => void;
	onRetry: () => void;
}): JSX.Element {
	const failed = forward.status === "failed";
	const statusText =
		forward.status === "active"
			? labels.statusActive
			: forward.status === "reconnecting"
				? labels.statusReconnecting
				: labels.statusFailed;
	return (
		<button
			type="button"
			// 断开的那条点下去是重试：对着一个连不上的地址点「预览」只会再失败一次。
			aria-label={failed ? labels.retry : labels.preview}
			title={failed ? (forward.error ?? labels.statusFailed) : `${labels.preview} ${forward.localAddress}`}
			onClick={failed ? onRetry : onPreview}
			className={cn(
				"inline-flex h-5 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 font-mono text-[11px] transition-colors",
				CHIP_TONE[forward.status],
			)}
		>
			<span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CHIP_DOT[forward.status])} />
			<span className="sr-only">{statusText}</span>
			<span className={cn("truncate", failed && "line-through decoration-destructive/40")}>
				{copied ? labels.copied : forward.localAddress}
			</span>
		</button>
	);
}

/** 行内确认终止：终止是不可撤销的，但为它弹一个对话框又太重。 */
function TerminateConfirm({
	row,
	labels,
	busy,
	onConfirm,
	onCancel,
}: {
	row: PortRowViewItem;
	labels: PortsTabPanelViewLabels;
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}): JSX.Element {
	const name = row.processName ?? String(row.port);
	return (
		<div className="flex min-w-0 items-center gap-1.5 pt-0.5">
			<span className="min-w-0 flex-1 truncate text-[11px] text-destructive">
				{labels.terminateConfirm(row.pid === undefined ? name : `${name} (PID ${row.pid})`)}
			</span>
			<Button
				type="button"
				size="xs"
				variant="ghost"
				disabled={busy}
				onClick={onConfirm}
				className="h-6 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
			>
				{busy ? <span aria-hidden className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" /> : null}
				{row.needsForceKill ? labels.forceTerminate : labels.terminate}
			</Button>
			<Button type="button" size="xs" variant="ghost" disabled={busy} onClick={onCancel} className="h-6">
				{labels.cancel}
			</Button>
		</div>
	);
}

/** 改本机端口：就地替换这一行的第二行，不另开表单。 */
function EditLocalPort({
	row,
	labels,
	value,
	onChange,
	onSubmit,
	onCancel,
}: {
	row: PortRowViewItem;
	labels: PortsTabPanelViewLabels;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (event: FormEvent) => void;
	onCancel: () => void;
}): JSX.Element {
	return (
		<form onSubmit={onSubmit} className="flex min-w-0 items-center gap-2 pt-1.5">
			<span className="shrink-0 font-mono text-[12px] text-muted-foreground">{labels.localPortPrefix}</span>
			<PortInput
				id={`ports-edit-${row.port}`}
				value={value}
				label={labels.changeLocalPort}
				placeholder={labels.localPortPlaceholder}
				size="sm"
				className="w-24"
				onChange={onChange}
			/>
			<span className="flex-1" />
			<Button type="submit" size="sm" className="h-8 rounded-lg px-3">
				{labels.save}
			</Button>
			<Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg px-3" onClick={onCancel}>
				{labels.cancel}
			</Button>
		</form>
	);
}

interface RowHandlers {
	readonly onForward: () => void;
	readonly onPreview: () => void;
	readonly onOpenExternal: () => void;
	readonly onCopyAddress: () => void;
	readonly onStartEdit: () => void;
	readonly onStop: () => void;
	readonly onRetry: () => void;
	readonly onRequestTerminate: () => void;
}

/**
 * 端口号徽标，贴在进程名左边：列表靠它扫读，已映射的换成实心主色。
 *
 * 默认态用前景色叠一层而不是 `bg-muted`：有的主题里 muted 与面板底色相同，徽标会整个消失。
 */
function PortBadge({ row }: { row: PortRowViewItem }): JSX.Element {
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono font-semibold text-[11px] tabular-nums",
				row.listening === false
					? "bg-foreground/[0.05] text-muted-foreground line-through"
					: row.forward
						? "bg-primary text-primary-foreground"
						: "bg-foreground/10 text-foreground",
			)}
		>
			{row.port}
		</span>
	);
}

/**
 * 一个远端服务。
 *
 * 主行是「端口徽标 + 进程名 · 启动时间 · 映射地址」，命令行有内容时才多一行——没有就不留
 * 空行，列表因此不会被一排排空白撑开。动作平时不占位置，悬停时盖在时间上淡入。
 * 已映射的整行描一圈主色边：它是用户亲手接到本机、正在用的东西。
 */
function PortRow({
	row,
	labels,
	copied,
	editing,
	editingLocalPort,
	confirming,
	terminating,
	handlers,
	onEditingLocalPortChange,
	onSubmitLocalPort,
	onCancelEditLocalPort,
	onConfirmTerminate,
	onCancelTerminate,
}: {
	row: PortRowViewItem;
	labels: PortsTabPanelViewLabels;
	copied: boolean;
	editing: boolean;
	editingLocalPort: string;
	confirming: boolean;
	terminating: boolean;
	handlers: RowHandlers;
	onEditingLocalPortChange: (value: string) => void;
	onSubmitLocalPort: (event: FormEvent) => void;
	onCancelEditLocalPort: () => void;
	onConfirmTerminate: () => void;
	onCancelTerminate: () => void;
}): JSX.Element {
	const forward = row.forward;
	const idle = !editing && !confirming && !terminating;
	let detail: ReactNode = null;
	if (editing) {
		detail = (
			<EditLocalPort
				row={row}
				labels={labels}
				value={editingLocalPort}
				onChange={onEditingLocalPortChange}
				onSubmit={onSubmitLocalPort}
				onCancel={onCancelEditLocalPort}
			/>
		);
	} else if (confirming || terminating) {
		detail = (
			<TerminateConfirm
				row={row}
				labels={labels}
				busy={terminating}
				onConfirm={onConfirmTerminate}
				onCancel={onCancelTerminate}
			/>
		);
	} else if (row.listening === false) {
		detail = <p className="truncate text-[11px] text-muted-foreground/60 italic">{labels.notListening}</p>;
	} else if (row.command) {
		detail = (
			<p className="truncate font-mono text-[11px] text-muted-foreground/60" title={row.command}>
				{row.command}
			</p>
		);
	}

	return (
		<li
			className={cn(
				"group relative rounded-xl px-3 py-2.5 transition-colors hover:bg-accent focus-within:bg-accent",
				forward && (forward.status === "failed" ? "ring-2 ring-destructive/70 ring-inset" : "ring-2 ring-primary ring-inset"),
				confirming && "bg-destructive/[0.04] hover:bg-destructive/[0.06]",
				row.sensitive && "opacity-60 hover:opacity-100",
			)}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					<PortBadge row={row} />
					<span
						className={cn(
							"truncate text-[13px]",
							row.processName ? "font-medium text-foreground" : "text-muted-foreground/50",
						)}
						title={row.pid === undefined ? undefined : `PID ${row.pid}`}
					>
						{row.processName ?? "—"}
					</span>
					{row.fromOutput ? (
						<span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary leading-4">
							{labels.fromOutput}
						</span>
					) : null}
					{row.publicBind ? (
						<span
							aria-label={labels.publicBind}
							title={labels.publicBind}
							className="icon-[solar--global-linear] h-3 w-3 shrink-0 text-muted-foreground/40"
						/>
					) : null}
				</span>
				<span className="relative flex shrink-0 items-center">
					{row.startedLabel ? (
						<span
							title={row.startedTitle}
							className={cn(
								"text-[11px] text-muted-foreground/50 tabular-nums transition-opacity",
								idle && "group-focus-within:opacity-0 group-hover:opacity-0",
							)}
						>
							{row.startedLabel}
						</span>
					) : null}
					{idle ? (
						// 动作盖在时间上：底色与悬停态一致，从右往左渐隐，不露出下面的名字。
						<span className="pointer-events-none absolute inset-y-[-4px] right-0 flex items-center gap-0.5 bg-gradient-to-l from-70% from-accent to-transparent pl-8 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
							{forward ? (
								<>
									<IconButton
										icon="icon-[solar--square-top-down-linear]"
										title={labels.openExternal}
										onClick={handlers.onOpenExternal}
									/>
									<IconButton icon="icon-[solar--copy-linear]" title={labels.copyAddress} onClick={handlers.onCopyAddress} />
									<IconButton
										icon="icon-[solar--pen-2-linear]"
										title={labels.changeLocalPort}
										onClick={handlers.onStartEdit}
									/>
									<IconButton icon="icon-[solar--link-broken-linear]" title={labels.stop} onClick={handlers.onStop} />
								</>
							) : row.listening === false ? null : (
								<button
									type="button"
									aria-label={labels.forward}
									title={`${labels.forward} ${row.port} → localhost`}
									onClick={handlers.onForward}
									className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 font-medium text-[11px] text-primary transition-colors hover:bg-primary/20"
								>
									<span aria-hidden className="icon-[solar--arrow-right-up-linear] h-3 w-3" />
									{labels.forward}
								</button>
							)}
							{row.killable ? (
								<IconButton
									icon="icon-[solar--stop-circle-linear]"
									title={row.needsForceKill ? labels.forceTerminate : labels.terminate}
									tone="danger"
									onClick={handlers.onRequestTerminate}
								/>
							) : null}
						</span>
					) : null}
				</span>
				{forward ? (
					<ForwardChip
						forward={forward}
						labels={labels}
						copied={copied}
						onPreview={handlers.onPreview}
						onRetry={handlers.onRetry}
					/>
				) : null}
			</div>
			{detail ? <div className="mt-1 min-w-0">{detail}</div> : null}
		</li>
	);
}

/** 折叠组：一行灰字，点开才列出。 */
function FoldedGroup({
	icon,
	label,
	title,
	open,
	onToggle,
	children,
}: {
	icon: string;
	label: string;
	title?: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}): JSX.Element {
	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				title={title}
				onClick={onToggle}
				className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[12px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
			>
				<span aria-hidden className={cn(icon, "h-4 w-4 shrink-0 text-muted-foreground/50")} />
				<span className="min-w-0 flex-1 truncate text-left">{label}</span>
				<span
					aria-hidden
					className={cn(
						"icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 shrink-0 transition-transform",
						!open && "-rotate-90",
					)}
				/>
			</button>
			{open ? <ul className="mt-1 space-y-1">{children}</ul> : null}
		</div>
	);
}

function SkeletonRows(): JSX.Element {
	return (
		<ul aria-hidden className="space-y-0.5">
			{[0, 1, 2].map((index) => (
				<li key={index} className="flex items-start gap-2 px-2 py-2">
					<span className={cn(PORT_COLUMN, "h-3.5 animate-pulse rounded bg-muted")} />
					<span className="flex flex-1 flex-col gap-1.5">
						<span className="h-3.5 w-24 animate-pulse rounded bg-muted" />
						<span className="h-2.5 w-40 animate-pulse rounded bg-muted/70" />
					</span>
				</li>
			))}
		</ul>
	);
}

/** 一段列表的标题：小号灰字加数量，靠留白而不是分隔线把两段分开。 */
function SectionLabel({ label, count }: { label: string; count: number }): JSX.Element {
	return (
		<div className="flex items-center gap-1.5 px-3 pb-1.5">
			<h4 className="font-medium text-[11px] text-muted-foreground/70 tracking-wide">{label}</h4>
			<span className="text-[11px] text-muted-foreground/40 tabular-nums">{count}</span>
		</div>
	);
}

function Stat({ dot, text }: { dot: string; text: string }): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
			<span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dot)} />
			{text}
		</span>
	);
}

interface RowGroups {
	readonly main: PortRowViewItem[];
	readonly unnamed: PortRowViewItem[];
	readonly ephemeral: PortRowViewItem[];
	readonly sensitive: PortRowViewItem[];
}

/**
 * 分组：主列表之外，系统端口、临时端口、认不出进程的端口各自折叠。
 *
 * 已映射的与任务输出里认出的一律留在主列表：前者是用户亲手接过来、正在用的，后者是他刚起
 * 的服务，折起来等于把他要找的东西藏了。认不出进程的端口（多半属于别的用户，读不到名字）
 * 一行只有一个号，摊在主列表里就是一整屏的「—」。
 */
function groupRows(rows: readonly PortRowViewItem[]): RowGroups {
	const groups: RowGroups = { main: [], unnamed: [], ephemeral: [], sensitive: [] };
	for (const row of rows) {
		if (row.forward || row.fromOutput) groups.main.push(row);
		else if (row.sensitive) groups.sensitive.push(row);
		else if (row.ephemeral) groups.ephemeral.push(row);
		else if (!row.processName) groups.unnamed.push(row);
		else groups.main.push(row);
	}
	return groups;
}

/**
 * 活动面板「端口映射」页：远程项目里，远端有哪些服务在跑、哪些已经映射到本机。
 *
 * 一行一个服务，按启动时间从新到旧：刚起的那个 dev server 总在最上面。系统端口（22 这类）
 * 与内核派出的临时端口各自折叠在列表末尾——它们总在，但几乎从来不是用户要找的东西。
 * 去掉分隔线和卡片边框，只靠留白与悬停底色分组：这一页要扫的是端口号和名字，线条只会抢眼。
 */
export function PortsTabPanelView({
	rows,
	scanState,
	scanError,
	labels,
	draftRemotePort,
	draftLocalPort,
	errorMessage,
	copiedPort,
	editingRemotePort,
	editingLocalPort,
	terminatingPort,
	onDraftRemotePortChange,
	onDraftLocalPortChange,
	onAddDraftPort,
	onForward,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStartEditLocalPort,
	onEditingLocalPortChange,
	onSubmitLocalPort,
	onCancelEditLocalPort,
	onStop,
	onRetry,
	onTerminate,
	onRefresh,
}: PortsTabPanelViewProps): JSX.Element {
	const [manualOpen, setManualOpen] = useState(false);
	const [sensitiveOpen, setSensitiveOpen] = useState(false);
	const [ephemeralOpen, setEphemeralOpen] = useState(false);
	const [unnamedOpen, setUnnamedOpen] = useState(false);
	const [confirmingPort, setConfirmingPort] = useState<number | undefined>(undefined);

	const groups = groupRows(rows);
	const { main, unnamed, ephemeral, sensitive } = groups;
	// 已映射的单独成段放在最上面：那是用户正在用的，其余是「还可以接过来的」。
	const mapped = main.filter((row) => row.forward);
	const unmapped = main.filter((row) => !row.forward);
	const running = rows.filter((row) => row.listening !== false).length;
	const forwarded = rows.filter((row) => row.forward).length;
	const nothingToShow = rows.length === 0 && scanState !== "loading";
	// 没有任何东西可点时手动那行自己展开：此时它是唯一的入口，藏在「+」后面等于没有入口。
	// 远端没有扫描工具（scanUnsupported）走的正是这条路。
	const showManual = manualOpen || nothingToShow;

	const renderRow = (row: PortRowViewItem): JSX.Element => (
		<PortRow
			key={row.port}
			row={row}
			labels={labels}
			copied={copiedPort === row.port}
			editing={editingRemotePort === row.port}
			editingLocalPort={editingLocalPort}
			confirming={confirmingPort === row.port}
			terminating={terminatingPort === row.port}
			handlers={{
				onForward: () => onForward(row.port),
				onPreview: () => onPreview(row.port),
				onOpenExternal: () => onOpenExternal(row.port),
				onCopyAddress: () => onCopyAddress(row.port),
				onStartEdit: () => onStartEditLocalPort(row.port),
				onStop: () => onStop(row.port),
				onRetry: () => onRetry(row.port),
				onRequestTerminate: () => setConfirmingPort(row.port),
			}}
			onEditingLocalPortChange={onEditingLocalPortChange}
			onSubmitLocalPort={onSubmitLocalPort}
			onCancelEditLocalPort={onCancelEditLocalPort}
			onConfirmTerminate={() => {
				setConfirmingPort(undefined);
				onTerminate(row.port);
			}}
			onCancelTerminate={() => setConfirmingPort(undefined)}
		/>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
				<div className="min-w-0 flex-1 space-y-1">
					<h3 className="font-semibold text-[14px] text-foreground tracking-tight">{labels.heading}</h3>
					{rows.length > 0 ? (
						<div className="flex items-center gap-3">
							<Stat dot="bg-emerald-500" text={labels.runningStat(running)} />
							{forwarded > 0 ? <Stat dot="bg-primary" text={labels.forwardedStat(forwarded)} /> : null}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-1 pt-0.5">
					<IconButton
						icon={cn("icon-[solar--refresh-linear]", scanState === "loading" && "animate-spin")}
						title={labels.refresh}
						onClick={onRefresh}
					/>
					<Button
						variant="ghost"
						size="xs"
						title={labels.addManual}
						aria-label={labels.addManual}
						aria-pressed={showManual}
						onClick={() => setManualOpen((open) => !open)}
						className={cn(
							"h-7 gap-1 rounded-lg px-2.5 text-[12px] text-muted-foreground hover:text-foreground",
							showManual && "bg-accent text-foreground",
						)}
					>
						<span aria-hidden className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
						{labels.manualTitle}
					</Button>
				</div>
			</header>

			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 pb-6">
				{showManual ? (
					<form onSubmit={onAddDraftPort} className="mx-0.5 rounded-2xl bg-foreground/[0.035] p-3.5">
						<div className="flex items-end gap-2">
							<PortInput
								id="ports-add-remote"
								value={draftRemotePort}
								label={labels.remotePortLabel}
								placeholder={labels.remotePortPlaceholder}
								showLabel
								className="min-w-0 flex-1"
								onChange={onDraftRemotePortChange}
							/>
							<span
								aria-hidden
								className="icon-[solar--arrow-right-linear] mb-2.5 h-4 w-4 shrink-0 text-muted-foreground/40"
							/>
							<PortInput
								id="ports-add-local"
								value={draftLocalPort}
								label={labels.localPortLabel}
								placeholder={labels.localPortPlaceholder}
								showLabel
								className="min-w-0 flex-1"
								onChange={onDraftLocalPortChange}
							/>
							<Button type="submit" disabled={draftRemotePort.trim() === ""} className="h-9 shrink-0 rounded-lg px-4">
								{labels.add}
							</Button>
						</div>
					</form>
				) : null}

				{errorMessage ? (
					<p className="mx-0.5 flex gap-2 rounded-xl bg-destructive/[0.07] px-3.5 py-2.5 text-[12px] text-destructive leading-relaxed">
						<span aria-hidden className="icon-[solar--danger-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
						{errorMessage}
					</p>
				) : null}

				{rows.length === 0 && scanState === "loading" ? <SkeletonRows /> : null}

				{nothingToShow ? (
					<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
						<span aria-hidden className="icon-[solar--server-square-linear] h-7 w-7 text-muted-foreground/30" />
						<span className="text-[13px] text-foreground/80">{labels.empty}</span>
						<span className="max-w-[20rem] text-[11px] text-muted-foreground/60 leading-relaxed">
							{labels.emptyHint}
						</span>
					</div>
				) : null}

				{mapped.length > 0 ? (
					<section>
						<SectionLabel label={labels.sectionForwarded} count={mapped.length} />
						<ul className="space-y-1.5">{mapped.map(renderRow)}</ul>
					</section>
				) : null}

				{unmapped.length > 0 ? (
					<section>
						<SectionLabel label={labels.sectionRunning} count={unmapped.length} />
						<ul className="space-y-1">{unmapped.map(renderRow)}</ul>
					</section>
				) : null}

				{/* 断开的原因排在列表下面：行里只放得下地址，而原因常常是一整句 ssh 的报错。 */}
				{rows
					.filter((row) => row.forward?.status === "failed" && row.forward.error)
					.map((row) => (
						<p key={row.port} className="px-3 text-[11px] text-destructive/80 leading-relaxed">
							<span className="font-mono tabular-nums">{row.port}</span>
							{`: ${row.forward?.error}`}
						</p>
					))}

				{unnamed.length + ephemeral.length + sensitive.length > 0 ? (
					<div className="space-y-1">
						{unnamed.length > 0 ? (
							<FoldedGroup
								icon="icon-[solar--question-circle-linear]"
								label={labels.unnamedToggle(unnamed.length)}
								title={labels.unnamedHint}
								open={unnamedOpen}
								onToggle={() => setUnnamedOpen((open) => !open)}
							>
								{unnamed.map(renderRow)}
							</FoldedGroup>
						) : null}
						{ephemeral.length > 0 ? (
							<FoldedGroup
								icon="icon-[solar--hourglass-line-linear]"
								label={labels.ephemeralToggle(ephemeral.length)}
								open={ephemeralOpen}
								onToggle={() => setEphemeralOpen((open) => !open)}
							>
								{ephemeral.map(renderRow)}
							</FoldedGroup>
						) : null}
						{sensitive.length > 0 ? (
							<FoldedGroup
								icon="icon-[solar--shield-keyhole-linear]"
								label={labels.sensitiveToggle(sensitive.length)}
								title={labels.sensitiveHint}
								open={sensitiveOpen}
								onToggle={() => setSensitiveOpen((open) => !open)}
							>
								{sensitive.map(renderRow)}
							</FoldedGroup>
						) : null}
					</div>
				) : null}

				{scanState === "unsupported" ? (
					<p className="px-3 text-[11px] text-muted-foreground/60 leading-relaxed">{labels.scanUnsupported}</p>
				) : null}
				{scanState === "failed" ? (
					<p className="px-3 text-[11px] text-muted-foreground/60 leading-relaxed">
						{labels.scanFailed}
						{scanError ? `：${scanError}` : ""}
					</p>
				) : null}
			</div>
		</div>
	);
}
