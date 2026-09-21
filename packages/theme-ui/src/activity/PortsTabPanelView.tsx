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
	readonly forwardedHeading: string;
	readonly candidatesHeading: string;
	readonly empty: string;
	readonly emptyHint: string;
	readonly addPlaceholder: string;
	readonly add: string;
	readonly forward: string;
	readonly preview: string;
	readonly openExternal: string;
	readonly copyAddress: string;
	readonly copied: string;
	readonly stop: string;
	readonly retry: string;
	readonly refresh: string;
	readonly statusReconnecting: string;
	readonly statusFailed: string;
	readonly scanning: string;
	readonly scanUnsupported: string;
	readonly scanFailed: string;
	readonly fromOutput: string;
	/** 本机端口与远端不同号时的提醒，形如「远端 5173 → 本机 52341」。 */
	readonly portChanged: (remotePort: number, localPort: number) => string;
}

export interface PortsTabPanelViewProps {
	readonly forwards: readonly PortForwardViewItem[];
	readonly candidates: readonly PortCandidateViewItem[];
	readonly scanState: PortScanState;
	/** scanState 为 failed 时的原因。 */
	readonly scanError?: string;
	readonly labels: PortsTabPanelViewLabels;
	readonly draftPort: string;
	/** 手动添加失败的原因，例如本机端口已被占用。 */
	readonly addError?: string;
	/** 刚复制过地址的那条转发的远端端口号。 */
	readonly copiedPort?: number;
	readonly onDraftPortChange: (value: string) => void;
	readonly onAddDraftPort: (event: FormEvent) => void;
	readonly onForwardCandidate: (port: number) => void;
	readonly onPreview: (remotePort: number) => void;
	readonly onOpenExternal: (remotePort: number) => void;
	readonly onCopyAddress: (remotePort: number) => void;
	readonly onStop: (remotePort: number) => void;
	readonly onRetry: (remotePort: number) => void;
	readonly onRefresh: () => void;
}

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

function SectionHeading({ children }: { children: string }): JSX.Element {
	return <h3 className="px-1 text-[11px] font-medium text-muted-foreground">{children}</h3>;
}

/** 已转发的一行。地址是用户真正要的东西，所以它是行里视觉最重的部分。 */
function ForwardRow({
	item,
	labels,
	copied,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStop,
	onRetry,
}: {
	item: PortForwardViewItem;
	labels: PortsTabPanelViewLabels;
	copied: boolean;
	onPreview: () => void;
	onOpenExternal: () => void;
	onCopyAddress: () => void;
	onStop: () => void;
	onRetry: () => void;
}): JSX.Element {
	const failed = item.status === "failed";
	return (
		<div
			className={`rounded-xl border bg-card/40 px-3 py-2.5 transition-colors duration-200 ${
				failed ? "border-destructive/40" : "border-border/50 hover:border-primary/40 hover:bg-card/60"
			}`}
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{item.remotePort}</span>
				<span aria-hidden className="icon-[solar--arrow-right-linear] h-3 w-3 shrink-0 text-muted-foreground/60" />
				<span className="min-w-0 truncate font-mono text-[13px] text-foreground">{item.localAddress}</span>
				{copied ? <span className="shrink-0 text-[11px] text-muted-foreground">{labels.copied}</span> : null}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{failed ? (
						<Button size="xs" variant="outline" onClick={onRetry}>
							{labels.retry}
						</Button>
					) : (
						<Button size="xs" variant="outline" onClick={onPreview}>
							{labels.preview}
						</Button>
					)}
					<IconButton icon="icon-[solar--copy-linear]" title={labels.copyAddress} onClick={onCopyAddress} />
					<IconButton
						icon="icon-[solar--square-top-down-linear]"
						title={labels.openExternal}
						onClick={onOpenExternal}
					/>
					<IconButton icon="icon-[solar--close-circle-linear]" title={labels.stop} onClick={onStop} />
				</div>
			</div>
			<div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
				{item.processName ? (
					<span className="truncate text-muted-foreground/70">{item.processName}</span>
				) : null}
				{item.status === "reconnecting" ? (
					<span className="flex shrink-0 items-center gap-1 text-amber-400">
						<span aria-hidden className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
						{labels.statusReconnecting}
					</span>
				) : null}
				{item.localPort !== item.remotePort ? (
					<span className="truncate text-amber-400">{labels.portChanged(item.remotePort, item.localPort)}</span>
				) : null}
			</div>
			{failed ? (
				<p className="mt-1.5 text-[11px] text-destructive">
					{labels.statusFailed}
					{item.error ? `：${item.error}` : ""}
				</p>
			) : null}
		</div>
	);
}

/**
 * 活动面板端口页：远程项目里，把远端跑着的服务接到本机来看。
 *
 * 顺序按用户的目的排：已经能看的地址在最上面，其次是「远端还有这些端口在听，要不要也转过来」，
 * 最后才是手动输入——用户多数时候并不需要记住端口号。
 */
export function PortsTabPanelView({
	forwards,
	candidates,
	scanState,
	scanError,
	labels,
	draftPort,
	addError,
	copiedPort,
	onDraftPortChange,
	onAddDraftPort,
	onForwardCandidate,
	onPreview,
	onOpenExternal,
	onCopyAddress,
	onStop,
	onRetry,
	onRefresh,
}: PortsTabPanelViewProps): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
				{forwards.length === 0 && candidates.length === 0 && scanState !== "loading" ? (
					<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
						<span aria-hidden className="icon-[solar--link-round-linear] h-8 w-8 text-muted-foreground/40" />
						<span className="text-[13px] text-muted-foreground">{labels.empty}</span>
						<span className="max-w-[24rem] text-[11px] text-muted-foreground/70">{labels.emptyHint}</span>
					</div>
				) : null}

				{forwards.length > 0 ? (
					<section className="space-y-1.5">
						<SectionHeading>{labels.forwardedHeading}</SectionHeading>
						{forwards.map((item) => (
							<ForwardRow
								key={item.remotePort}
								item={item}
								labels={labels}
								copied={copiedPort === item.remotePort}
								onPreview={() => onPreview(item.remotePort)}
								onOpenExternal={() => onOpenExternal(item.remotePort)}
								onCopyAddress={() => onCopyAddress(item.remotePort)}
								onStop={() => onStop(item.remotePort)}
								onRetry={() => onRetry(item.remotePort)}
							/>
						))}
					</section>
				) : null}

				{candidates.length > 0 ? (
					<section className="space-y-1.5">
						<div className="flex items-center justify-between gap-2">
							<SectionHeading>{labels.candidatesHeading}</SectionHeading>
							<IconButton icon="icon-[solar--refresh-linear]" title={labels.refresh} onClick={onRefresh} />
						</div>
						{candidates.map((candidate) => (
							<div
								key={candidate.port}
								className="flex min-w-0 items-center gap-2 rounded-lg border border-border/40 px-3 py-2"
							>
								<span className="shrink-0 font-mono text-[13px] tabular-nums text-foreground">{candidate.port}</span>
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
					</section>
				) : null}

				{scanState === "loading" ? (
					<p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
						<span aria-hidden className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
						{labels.scanning}
					</p>
				) : null}
				{scanState === "unsupported" ? (
					<p className="px-1 text-[11px] text-muted-foreground">{labels.scanUnsupported}</p>
				) : null}
				{scanState === "failed" ? (
					<p className="px-1 text-[11px] text-muted-foreground">
						{labels.scanFailed}
						{scanError ? `：${scanError}` : ""}
					</p>
				) : null}
			</div>

			<form onSubmit={onAddDraftPort} className="shrink-0 border-t border-border/60 p-2">
				<div className="flex items-center gap-2">
					<label className="sr-only" htmlFor="ports-add-input">
						{labels.addPlaceholder}
					</label>
					<input
						id="ports-add-input"
						type="text"
						inputMode="numeric"
						value={draftPort}
						spellCheck={false}
						placeholder={labels.addPlaceholder}
						onChange={(event) => onDraftPortChange(event.target.value)}
						className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-transparent px-2.5 font-mono text-[12px] text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/40 focus:border-primary/40"
					/>
					<Button type="submit" size="xs" variant="outline" disabled={draftPort.trim() === ""}>
						{labels.add}
					</Button>
				</div>
				{addError ? <p className="mt-1.5 px-0.5 text-[11px] text-destructive">{addError}</p> : null}
			</form>
		</div>
	);
}
