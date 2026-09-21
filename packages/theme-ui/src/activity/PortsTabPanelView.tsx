import { Button } from "@vetta-org/ui";
import type { FormEvent, JSX } from "react";

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
	readonly add: string;
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
}

export interface PortsTabPanelViewProps {
	readonly forwards: readonly PortForwardViewItem[];
	readonly candidates: readonly PortCandidateViewItem[];
	readonly scanState: PortScanState;
	/** scanState 为 failed 时的原因。 */
	readonly scanError?: string;
	readonly labels: PortsTabPanelViewLabels;
	/** 底部表单：远端端口号。 */
	readonly draftRemotePort: string;
	/** 底部表单：本机端口号，留空表示与远端同号。 */
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

const STATUS_STYLES: Record<PortForwardViewStatus, { rail: string; dot: string; text: string }> = {
	active: { rail: "bg-emerald-500/50", dot: "bg-emerald-400", text: "text-emerald-400" },
	reconnecting: { rail: "bg-amber-500/50", dot: "bg-amber-400", text: "text-amber-400" },
	failed: { rail: "bg-destructive/50", dot: "bg-destructive", text: "text-destructive" },
};

function IconButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }): JSX.Element {
	return (
		<Button variant="ghost" size="icon-xs" title={title} aria-label={title} onClick={onClick} className="shrink-0">
			<span aria-hidden className={`${icon} h-3.5 w-3.5`} />
		</Button>
	);
}

/** 端口号输入框：面板里出现三次（改本机端口、底部两个），视觉必须是同一个。 */
function PortInput({
	id,
	value,
	label,
	placeholder,
	width,
	onChange,
}: {
	id: string;
	value: string;
	label: string;
	placeholder: string;
	width: string;
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
				className={`h-7 ${width} rounded-lg border border-border/60 bg-input/40 px-2 text-center font-mono text-[12px] tabular-nums text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-[11px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-input/70`}
			/>
		</>
	);
}

function SectionHeading({ label, count }: { label: string; count?: number }): JSX.Element {
	return (
		<div className="flex items-center gap-1.5 px-0.5">
			<h3 className="text-[11px] font-medium tracking-wide text-muted-foreground">{label}</h3>
			{count === undefined ? null : (
				<span className="rounded-full bg-accent/60 px-1.5 text-[10px] tabular-nums text-muted-foreground">
					{count}
				</span>
			)}
		</div>
	);
}

/**
 * 已转发的一条。
 *
 * 主体是「远端号 → 本机地址」这一条映射：本机那半边是用户真正要用的东西，所以它最重，并且
 * 可以就地改号——远端 5173 在本机被占用时，用户通常心里有一个想用的号。
 */
function ForwardCard({
	item,
	labels,
	copied,
	editing,
	editingLocalPort,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStartEdit,
	onEditingChange,
	onSubmitEdit,
	onCancelEdit,
	onStop,
	onRetry,
}: {
	item: PortForwardViewItem;
	labels: PortsTabPanelViewLabels;
	copied: boolean;
	editing: boolean;
	editingLocalPort: string;
	onPreview: () => void;
	onOpenExternal: () => void;
	onCopyAddress: () => void;
	onStartEdit: () => void;
	onEditingChange: (value: string) => void;
	onSubmitEdit: (event: FormEvent) => void;
	onCancelEdit: () => void;
	onStop: () => void;
	onRetry: () => void;
}): JSX.Element {
	const status = STATUS_STYLES[item.status];
	const failed = item.status === "failed";
	return (
		<div
			className={`relative overflow-hidden rounded-xl border bg-card/40 pl-3.5 pr-2.5 py-2.5 transition-colors duration-200 ${
				failed ? "border-destructive/40" : "border-border/50 hover:border-primary/40 hover:bg-card/60"
			}`}
		>
			<span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${status.rail}`} />
			<div className="flex min-w-0 items-center gap-2">
				<span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
				<span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{item.remotePort}</span>
				<span aria-hidden className="icon-[solar--arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground/50" />
				{editing ? (
					<form onSubmit={onSubmitEdit} className="flex min-w-0 items-center gap-1.5">
						<span className="shrink-0 font-mono text-[13px] text-muted-foreground">{labels.localPortPrefix}</span>
						<PortInput
							id={`ports-edit-${item.remotePort}`}
							value={editingLocalPort}
							label={labels.changeLocalPort}
							placeholder={labels.localPortPlaceholder}
							width="w-[4.5rem]"
							onChange={onEditingChange}
						/>
						<Button type="submit" size="xs" variant="outline">
							{labels.save}
						</Button>
						<Button type="button" size="xs" variant="ghost" onClick={onCancelEdit}>
							{labels.cancel}
						</Button>
					</form>
				) : (
					<>
						<span className="min-w-0 truncate font-mono text-[13px] text-foreground">{item.localAddress}</span>
						{copied ? <span className="shrink-0 text-[11px] text-muted-foreground">{labels.copied}</span> : null}
						<div className="ml-auto flex shrink-0 items-center gap-0.5">
							{failed ? (
								<Button size="xs" variant="outline" onClick={onRetry}>
									{labels.retry}
								</Button>
							) : (
								<Button size="xs" variant="outline" onClick={onPreview}>
									{labels.preview}
								</Button>
							)}
							<IconButton
								icon="icon-[solar--pen-2-linear]"
								title={labels.changeLocalPort}
								onClick={onStartEdit}
							/>
							<IconButton icon="icon-[solar--copy-linear]" title={labels.copyAddress} onClick={onCopyAddress} />
							<IconButton
								icon="icon-[solar--square-top-down-linear]"
								title={labels.openExternal}
								onClick={onOpenExternal}
							/>
							<IconButton icon="icon-[solar--close-circle-linear]" title={labels.stop} onClick={onStop} />
						</div>
					</>
				)}
			</div>
			<div className="mt-1 flex min-w-0 items-center gap-2 pl-3.5 text-[11px]">
				<span className={`shrink-0 ${status.text}`}>
					{item.status === "active"
						? labels.statusActive
						: item.status === "reconnecting"
							? labels.statusReconnecting
							: labels.statusFailed}
				</span>
				{item.processName ? (
					<>
						<span aria-hidden className="text-muted-foreground/30">
							·
						</span>
						<span className="min-w-0 truncate text-muted-foreground/70">{item.processName}</span>
					</>
				) : null}
			</div>
			{failed && item.error ? <p className="mt-1.5 pl-3.5 text-[11px] text-destructive/80">{item.error}</p> : null}
		</div>
	);
}

/**
 * 活动面板端口页：远程项目里，把远端跑着的服务接到本机来看。
 *
 * 顺序按用户的目的排：已经能打开的地址在最上面，其次是「远端还有这些端口在听，要不要也转过来」，
 * 最后才是手动输入——多数时候用户并不需要记住那个号。
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
	const nothingToShow = forwards.length === 0 && candidates.length === 0 && scanState !== "loading";
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
				<SectionHeading label={labels.heading} count={forwards.length || undefined} />
				<IconButton icon="icon-[solar--refresh-linear]" title={labels.refresh} onClick={onRefresh} />
			</div>

			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
				{nothingToShow ? (
					<div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
						<span aria-hidden className="icon-[solar--link-round-linear] h-8 w-8 text-muted-foreground/40" />
						<span className="text-[13px] text-foreground">{labels.empty}</span>
						<span className="max-w-[22rem] text-[11px] leading-relaxed text-muted-foreground/70">
							{labels.emptyHint}
						</span>
					</div>
				) : null}

				{forwards.length > 0 ? (
					<section className="space-y-2">
						{forwards.map((item) => (
							<ForwardCard
								key={item.remotePort}
								item={item}
								labels={labels}
								copied={copiedPort === item.remotePort}
								editing={editingRemotePort === item.remotePort}
								editingLocalPort={editingLocalPort}
								onPreview={() => onPreview(item.remotePort)}
								onOpenExternal={() => onOpenExternal(item.remotePort)}
								onCopyAddress={() => onCopyAddress(item.remotePort)}
								onStartEdit={() => onStartEditLocalPort(item.remotePort)}
								onEditingChange={onEditingLocalPortChange}
								onSubmitEdit={onSubmitLocalPort}
								onCancelEdit={onCancelEditLocalPort}
								onStop={() => onStop(item.remotePort)}
								onRetry={() => onRetry(item.remotePort)}
							/>
						))}
					</section>
				) : null}

				{candidates.length > 0 ? (
					<section className="space-y-1">
						<SectionHeading label={labels.candidatesHeading} count={candidates.length} />
						<div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/40">
							{candidates.map((candidate) => (
								<div
									key={candidate.port}
									className="flex min-w-0 items-center gap-2 bg-card/20 px-3 py-2 transition-colors hover:bg-card/50"
								>
									<span className="shrink-0 font-mono text-[13px] tabular-nums text-foreground">
										{candidate.port}
									</span>
									{candidate.processName ? (
										<span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
											{candidate.processName}
										</span>
									) : null}
									{candidate.origin === "output" ? (
										<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
											{labels.fromOutput}
										</span>
									) : null}
									<Button
										size="xs"
										variant="ghost"
										className="ml-auto shrink-0"
										onClick={() => onForwardCandidate(candidate.port)}
									>
										{labels.forward}
									</Button>
								</div>
							))}
						</div>
					</section>
				) : null}

				{scanState === "loading" ? (
					<p className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
						<span aria-hidden className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
						{labels.scanning}
					</p>
				) : null}
				{scanState === "unsupported" ? (
					<p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{labels.scanUnsupported}</p>
				) : null}
				{scanState === "failed" ? (
					<p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
						{labels.scanFailed}
						{scanError ? `：${scanError}` : ""}
					</p>
				) : null}
			</div>

			<form onSubmit={onAddDraftPort} className="shrink-0 border-t border-border/60 px-3 py-2.5">
				<div className="flex items-center gap-1.5">
					<PortInput
						id="ports-add-remote"
						value={draftRemotePort}
						label={labels.remotePortPlaceholder}
						placeholder={labels.remotePortPlaceholder}
						width="w-[5.5rem]"
						onChange={onDraftRemotePortChange}
					/>
					<span aria-hidden className="icon-[solar--arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground/50" />
					<span className="shrink-0 font-mono text-[12px] text-muted-foreground">{labels.localPortPrefix}</span>
					<PortInput
						id="ports-add-local"
						value={draftLocalPort}
						label={labels.localPortPlaceholder}
						placeholder={labels.localPortPlaceholder}
						width="w-[5rem]"
						onChange={onDraftLocalPortChange}
					/>
					<Button
						type="submit"
						size="xs"
						variant="outline"
						className="ml-auto"
						disabled={draftRemotePort.trim() === ""}
					>
						{labels.add}
					</Button>
				</div>
				{errorMessage ? <p className="mt-1.5 px-0.5 text-[11px] text-destructive">{errorMessage}</p> : null}
			</form>
		</div>
	);
}
