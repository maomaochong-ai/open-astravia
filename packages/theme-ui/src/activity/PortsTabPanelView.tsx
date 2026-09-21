import { Button, cn } from "@vetta-org/ui";
import { type FormEvent, type JSX, useState } from "react";

export type PortForwardViewStatus = "active" | "reconnecting" | "failed";

/** 一条已经建立的转发。 */
export interface PortForwardViewItem {
	readonly remotePort: number;
	readonly localPort: number;
	/** 用户要复制或打开的那个地址，例如 `localhost:3000`。 */
	readonly localAddress: string;
	readonly processName?: string;
	readonly status: PortForwardViewStatus;
	/** status 为 failed 时的技术原因，原样来自 ssh。 */
	readonly error?: string;
}

/** 远端在听、但还没转发的端口。 */
export interface PortCandidateViewItem {
	readonly port: number;
	readonly processName?: string;
	/** `output` 表示从任务输出里认出的地址，`scan` 表示扫描远端得到的。 */
	readonly origin: "scan" | "output";
}

/** 扫描远端端口的结果。`unsupported` 是远端没有可用的扫描工具。 */
export type PortScanState = "loading" | "ready" | "unsupported" | "failed";

export interface PortsTabPanelViewLabels {
	readonly heading: string;
	readonly candidatesHeading: string;
	readonly empty: string;
	readonly emptyHint: string;
	readonly remotePortPlaceholder: string;
	readonly localPortPlaceholder: string;
	readonly localPortPrefix: string;
	/** 端口号前面的「远端」前缀，例如「远端 3000」。 */
	readonly remoteLabel: string;
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
	readonly scanning: string;
	readonly scanUnsupported: string;
	readonly scanFailed: string;
	readonly fromOutput: string;
	/** 折叠起来的临时端口那一行；数量只有视图知道，所以这条是函数而不是成品字符串。 */
	readonly ephemeralToggle: (count: number) => string;
}

export interface PortsTabPanelViewProps {
	readonly forwards: readonly PortForwardViewItem[];
	readonly candidates: readonly PortCandidateViewItem[];
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
	/** 刚复制过地址的那条转发的远端端口号。 */
	readonly copiedPort?: number;
	/** 正在改本机端口的那条转发的远端端口号。 */
	readonly editingRemotePort?: number;
	readonly editingLocalPort: string;
	readonly onDraftRemotePortChange: (value: string) => void;
	readonly onDraftLocalPortChange: (value: string) => void;
	readonly onAddDraftPort: (event: FormEvent) => void;
	readonly onForwardCandidate: (port: number) => void;
	readonly onPreview: (remotePort: number) => void;
	readonly onOpenExternal: (remotePort: number) => void;
	readonly onCopyAddress: (remotePort: number) => void;
	readonly onStartEditLocalPort: (remotePort: number) => void;
	readonly onEditingLocalPortChange: (value: string) => void;
	readonly onSubmitLocalPort: (event: FormEvent) => void;
	readonly onCancelEditLocalPort: () => void;
	readonly onStop: (remotePort: number) => void;
	readonly onRetry: (remotePort: number) => void;
	readonly onRefresh: () => void;
}

/**
 * 格子最小宽度。
 *
 * `localhost:65535` 在 12px 等宽字体下约 110px，加上状态点与内边距取 8.5rem：比这更窄
 * 地址就得截断，而地址正是用户要复制、要打开的那个东西，截了这张格子就没有意义了。
 * 面板默认 400px 上下正好两列，拉宽自动变三列四列。
 */
const GRID = "grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))]";

/** 候选格子只有端口号和进程名，不必按地址的宽度留位置。 */
const CANDIDATE_GRID = "grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(5.5rem,1fr))]";

/**
 * 临时端口的起点（Linux 默认 ip_local_port_range 的下界）。
 *
 * 这个区间里在听的基本都是内核派给连接的临时端口，不是任何人想转发的服务——远端随便
 * 一台机器就能扫出几十个，混在一起时用户要找的 3000 会被它们淹掉。所以默认折叠起来，
 * 但仍然给出数量和展开入口：判断依据只是端口号，总有例外。
 */
const EPHEMERAL_PORT_FLOOR = 32768;

const STATUS_DOT: Record<PortForwardViewStatus, string> = {
	active: "bg-emerald-400",
	reconnecting: "bg-amber-400 animate-pulse",
	failed: "bg-destructive",
};

function IconButton({
	icon,
	title,
	onClick,
}: {
	icon: string;
	title: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<Button variant="ghost" size="icon-xs" title={title} aria-label={title} onClick={onClick} className="shrink-0">
			<span aria-hidden className={`${icon} h-3.5 w-3.5`} />
		</Button>
	);
}

/** 端口号输入框：面板里出现三次（改本机端口、手动那行两个），视觉必须是同一个。 */
function PortInput({
	id,
	value,
	label,
	placeholder,
	className,
	onChange,
}: {
	id: string;
	value: string;
	label: string;
	placeholder: string;
	className: string;
	onChange: (value: string) => void;
}): JSX.Element {
	return (
		<>
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			<input
				id={id}
				type="text"
				inputMode="numeric"
				value={value}
				spellCheck={false}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				className={cn(
					"h-7 rounded-lg border border-border/60 bg-input/40 px-2 text-center font-mono text-[12px] text-foreground tabular-nums outline-none transition-colors placeholder:font-sans placeholder:text-[11px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-input/70",
					className,
				)}
			/>
		</>
	);
}

function SectionHeading({ label, count }: { label: string; count?: number }): JSX.Element {
	return (
		<div className="flex items-center gap-1.5 px-0.5">
			<h3 className="font-medium text-[11px] text-muted-foreground tracking-wide">{label}</h3>
			{count === undefined ? null : (
				<span className="rounded-full bg-accent/60 px-1.5 text-[10px] text-muted-foreground tabular-nums">
					{count}
				</span>
			)}
		</div>
	);
}

/**
 * 已转发的一格。
 *
 * 整张格子就是「打开它」——预览是这里九成的意图，把它做成主按钮，用户不用先找按钮再点。
 * 其余四个动作平时不占位置：悬停时盖在副行上淡入，格子高度因此始终一致，鼠标扫过一片
 * 格子时不会有东西在跳。
 */
function ForwardTile({
	item,
	labels,
	copied,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStartEdit,
	onStop,
	onRetry,
}: {
	item: PortForwardViewItem;
	labels: PortsTabPanelViewLabels;
	copied: boolean;
	onPreview: () => void;
	onOpenExternal: () => void;
	onCopyAddress: () => void;
	onStartEdit: () => void;
	onStop: () => void;
	onRetry: () => void;
}): JSX.Element {
	const failed = item.status === "failed";
	const statusText =
		item.status === "active"
			? labels.statusActive
			: item.status === "reconnecting"
				? labels.statusReconnecting
				: labels.statusFailed;
	return (
		<div className="group relative min-w-0">
			<button
				type="button"
				// 断开的那条点下去是重试：对着一个连不上的地址点「预览」只会再失败一次。
				aria-label={failed ? labels.retry : labels.preview}
				title={failed ? (item.error ?? labels.statusFailed) : item.localAddress}
				onClick={failed ? onRetry : onPreview}
				className={cn(
					"flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors",
					failed
						? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
						: "border-border/50 bg-card/30 hover:border-primary/40 hover:bg-card/60",
				)}
			>
				<span className="flex w-full min-w-0 items-center gap-1.5">
					<span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[item.status])} />
					<span className="sr-only">{statusText}</span>
					<span
						className={cn(
							"min-w-0 truncate font-mono text-[12px]",
							failed ? "text-muted-foreground line-through decoration-destructive/40" : "text-foreground",
						)}
					>
						{item.localAddress}
					</span>
				</span>
				<span className="flex w-full min-w-0 items-center gap-1 text-[10px] text-muted-foreground/70">
					{copied ? (
						<span className="truncate text-primary">{labels.copied}</span>
					) : (
						<>
							<span className="shrink-0 tabular-nums">
								{labels.remoteLabel} {item.remotePort}
							</span>
							{item.processName ? (
								<>
									<span aria-hidden className="text-muted-foreground/30">
										·
									</span>
									<span className="min-w-0 truncate">{item.processName}</span>
								</>
							) : null}
						</>
					)}
				</span>
			</button>
			{/*
			 * 动作条盖在副行上，而不是排在格子里：四个图标按钮排开就是一整行的高度，
			 * 每张格子都留着它，一屏能看到的端口直接少一半。
			 */}
			<div className="pointer-events-none absolute inset-x-[3px] bottom-[3px] flex items-center justify-end rounded-b-[7px] bg-gradient-to-l from-card via-card to-transparent pl-6 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
				<IconButton icon="icon-[solar--pen-2-linear]" title={labels.changeLocalPort} onClick={onStartEdit} />
				<IconButton icon="icon-[solar--copy-linear]" title={labels.copyAddress} onClick={onCopyAddress} />
				<IconButton
					icon="icon-[solar--square-top-down-linear]"
					title={labels.openExternal}
					onClick={onOpenExternal}
				/>
				<IconButton icon="icon-[solar--close-circle-linear]" title={labels.stop} onClick={onStop} />
			</div>
		</div>
	);
}

/**
 * 改本机端口时那一格铺满整行。
 *
 * 输入框加两个按钮在一格的宽度里放不下，而这是个瞬时状态——占一行换来不必缩写任何东西。
 */
function EditTile({
	item,
	labels,
	value,
	onChange,
	onSubmit,
	onCancel,
}: {
	item: PortForwardViewItem;
	labels: PortsTabPanelViewLabels;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (event: FormEvent) => void;
	onCancel: () => void;
}): JSX.Element {
	return (
		<form
			onSubmit={onSubmit}
			className="col-span-full flex min-w-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-card/60 px-2 py-1.5"
		>
			<span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{item.remotePort}</span>
			<span aria-hidden className="icon-[solar--arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground/50" />
			<span className="shrink-0 font-mono text-[12px] text-muted-foreground">{labels.localPortPrefix}</span>
			<PortInput
				id={`ports-edit-${item.remotePort}`}
				value={value}
				label={labels.changeLocalPort}
				placeholder={labels.localPortPlaceholder}
				className="w-[4.5rem]"
				onChange={onChange}
			/>
			<Button type="submit" size="xs" variant="outline" className="ml-auto">
				{labels.save}
			</Button>
			<Button type="button" size="xs" variant="ghost" onClick={onCancel}>
				{labels.cancel}
			</Button>
		</form>
	);
}

/** 远端在听、还没转发的一格：整张就是「转发它」。 */
function CandidateTile({
	candidate,
	labels,
	onForward,
}: {
	candidate: PortCandidateViewItem;
	labels: PortsTabPanelViewLabels;
	onForward: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={labels.forward}
			title={`${labels.forward} ${candidate.port}`}
			onClick={onForward}
			className="group flex min-w-0 items-center gap-1 rounded-lg border border-border/40 border-dashed px-2 py-1.5 text-left transition-colors hover:border-primary/50 hover:border-solid hover:bg-card/50"
		>
			{candidate.origin === "output" ? (
				<>
					{/* 来自任务输出的排在最前，也标出来：那是用户刚起的服务，与扫到的一堆系统端口不同。 */}
					<span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
					<span className="sr-only">{labels.fromOutput}</span>
				</>
			) : null}
			<span className="shrink-0 font-mono text-[12px] text-foreground tabular-nums">{candidate.port}</span>
			{candidate.processName ? (
				<span className="min-w-0 truncate text-[10px] text-muted-foreground/70">{candidate.processName}</span>
			) : null}
			<span
				aria-hidden
				className="icon-[solar--add-circle-linear] ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary"
			/>
		</button>
	);
}

/**
 * 活动面板端口页：远程项目里，把远端跑着的服务接到本机来看。
 *
 * 排成格子而不是列表：一条转发真正要显示的只有「本机地址 + 它是哪个远端端口」两行字，
 * 摊成整行宽的卡片后每条占掉 80px，开五六个服务就得翻页；两列格子把同样的信息压到一半
 * 高度，而端口这种东西多是扫一眼找目标，密度比每条的表现力更要紧。
 */
export function PortsTabPanelView({
	forwards,
	candidates,
	scanState,
	scanError,
	labels,
	draftRemotePort,
	draftLocalPort,
	errorMessage,
	copiedPort,
	editingRemotePort,
	editingLocalPort,
	onDraftRemotePortChange,
	onDraftLocalPortChange,
	onAddDraftPort,
	onForwardCandidate,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStartEditLocalPort,
	onEditingLocalPortChange,
	onSubmitLocalPort,
	onCancelEditLocalPort,
	onStop,
	onRetry,
	onRefresh,
}: PortsTabPanelViewProps): JSX.Element {
	const [manualOpen, setManualOpen] = useState(false);
	const [ephemeralOpen, setEphemeralOpen] = useState(false);
	const ephemeral = candidates.filter(
		(candidate) => candidate.origin !== "output" && candidate.port >= EPHEMERAL_PORT_FLOOR,
	);
	const shownCandidates = ephemeralOpen ? candidates : candidates.filter((candidate) => !ephemeral.includes(candidate));
	const nothingToShow = forwards.length === 0 && candidates.length === 0 && scanState !== "loading";
	// 没有任何东西可点时手动那行自己展开：此时它是唯一的入口，藏在「+」后面等于没有入口。
	// 远端没有扫描工具（scanUnsupported）走的正是这条路。
	const showManual = manualOpen || nothingToShow;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1.5 border-border/60 border-b px-2.5 py-1.5">
				<SectionHeading label={labels.heading} count={forwards.length || undefined} />
				<div className="ml-auto flex shrink-0 items-center gap-0.5">
					<IconButton icon="icon-[solar--refresh-linear]" title={labels.refresh} onClick={onRefresh} />
					<Button
						variant="ghost"
						size="icon-xs"
						title={labels.addManual}
						aria-label={labels.addManual}
						aria-pressed={showManual}
						onClick={() => setManualOpen((open) => !open)}
						className={cn("shrink-0", showManual && "bg-accent text-foreground")}
					>
						<span aria-hidden className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5">
				{showManual ? (
					<form onSubmit={onAddDraftPort} className="flex items-center gap-1.5">
						<PortInput
							id="ports-add-remote"
							value={draftRemotePort}
							label={labels.remotePortPlaceholder}
							placeholder={labels.remotePortPlaceholder}
							className="min-w-0 flex-1"
							onChange={onDraftRemotePortChange}
						/>
						<span aria-hidden className="icon-[solar--arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground/50" />
						<PortInput
							id="ports-add-local"
							value={draftLocalPort}
							label={labels.localPortPlaceholder}
							placeholder={labels.localPortPlaceholder}
							className="min-w-0 flex-1"
							onChange={onDraftLocalPortChange}
						/>
						<Button type="submit" size="xs" variant="outline" disabled={draftRemotePort.trim() === ""}>
							{labels.add}
						</Button>
					</form>
				) : null}
				{errorMessage ? <p className="px-0.5 text-[11px] text-destructive">{errorMessage}</p> : null}

				{nothingToShow ? (
					<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
						<span aria-hidden className="icon-[solar--link-round-linear] h-8 w-8 text-muted-foreground/40" />
						<span className="text-[13px] text-foreground">{labels.empty}</span>
						<span className="max-w-[22rem] text-[11px] text-muted-foreground/70 leading-relaxed">
							{labels.emptyHint}
						</span>
					</div>
				) : null}

				{forwards.length > 0 ? (
					<section className={GRID}>
						{forwards.map((item) =>
							editingRemotePort === item.remotePort ? (
								<EditTile
									key={item.remotePort}
									item={item}
									labels={labels}
									value={editingLocalPort}
									onChange={onEditingLocalPortChange}
									onSubmit={onSubmitLocalPort}
									onCancel={onCancelEditLocalPort}
								/>
							) : (
								<ForwardTile
									key={item.remotePort}
									item={item}
									labels={labels}
									copied={copiedPort === item.remotePort}
									onPreview={() => onPreview(item.remotePort)}
									onOpenExternal={() => onOpenExternal(item.remotePort)}
									onCopyAddress={() => onCopyAddress(item.remotePort)}
									onStartEdit={() => onStartEditLocalPort(item.remotePort)}
									onStop={() => onStop(item.remotePort)}
									onRetry={() => onRetry(item.remotePort)}
								/>
							),
						)}
					</section>
				) : null}

				{/* 断开的原因排在格子下面：格子里只放得下地址，而原因常常是一整句 ssh 的报错。 */}
				{forwards
					.filter((item) => item.status === "failed" && item.error)
					.map((item) => (
						<p key={item.remotePort} className="px-0.5 text-[11px] text-destructive/80">
							<span className="font-mono tabular-nums">{item.remotePort}</span>
							{`: ${item.error}`}
						</p>
					))}

				{candidates.length > 0 ? (
					<section className="space-y-1.5">
						<SectionHeading label={labels.candidatesHeading} count={candidates.length} />
						<div className={CANDIDATE_GRID}>
							{shownCandidates.map((candidate) => (
								<CandidateTile
									key={candidate.port}
									candidate={candidate}
									labels={labels}
									onForward={() => onForwardCandidate(candidate.port)}
								/>
							))}
						</div>
						{ephemeral.length > 0 ? (
							<button
								type="button"
								onClick={() => setEphemeralOpen((open) => !open)}
								className="flex w-full items-center gap-1 px-0.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
							>
								<span
									aria-hidden
									className={cn(
										"icon-[solar--alt-arrow-right-linear] h-3 w-3 transition-transform",
										ephemeralOpen && "rotate-90",
									)}
								/>
								{labels.ephemeralToggle(ephemeral.length)}
							</button>
						) : null}
					</section>
				) : null}

				{scanState === "loading" ? (
					<p className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
						<span aria-hidden className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
						{labels.scanning}
					</p>
				) : null}
				{scanState === "unsupported" ? (
					<p className="px-0.5 text-[11px] text-muted-foreground/70 leading-relaxed">{labels.scanUnsupported}</p>
				) : null}
				{scanState === "failed" ? (
					<p className="px-0.5 text-[11px] text-muted-foreground/70 leading-relaxed">
						{labels.scanFailed}
						{scanError ? `：${scanError}` : ""}
					</p>
				) : null}
			</div>
		</div>
	);
}
