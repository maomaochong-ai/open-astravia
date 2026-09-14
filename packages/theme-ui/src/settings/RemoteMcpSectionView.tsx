import { useMemo, useState, type JSX } from "react";
import { Button, cn } from "@vetta-org/ui";
import { McpDefaultIcon } from "./McpDefaultIcon";
import type { SettingSectionMeta } from "./SettingChrome";

export interface RemoteMcpServerRowView {
	readonly id: string | number;
	readonly name: string;
	readonly display_name?: string;
	readonly description?: string;
	/** 绝对或相对图标 URL；空则使用默认图标 */
	readonly icon?: string;
}

export interface RemoteMcpSectionViewLabels {
	readonly add: string;
	readonly added: string;
	readonly loading: string;
	readonly noRemoteMcp: string;
	readonly processing: string;
	readonly refresh: string;
	readonly remoteAllAdded: string;
	readonly remoteListTitle: string;
	readonly remoteSupport: string;
	readonly remove: string;
}

export interface RemoteMcpSectionViewModel {
	readonly items: readonly RemoteMcpServerRowView[] | null;
	readonly loading: boolean;
	readonly error: string | null;
	readonly busy: string | null;
	readonly load: () => void;
	readonly handleAction: (server: RemoteMcpServerRowView, action: "add" | "remove") => Promise<void>;
}

export interface RemoteMcpSectionViewProps {
	readonly addedNames: Set<string>;
	readonly discover?: boolean;
	readonly labels: RemoteMcpSectionViewLabels;
	readonly model: RemoteMcpSectionViewModel;
	readonly showHeader?: boolean;
	readonly remoteSection: SettingSectionMeta;
}

const GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5";

export function RemoteMcpSectionView({
	addedNames,
	discover = false,
	labels,
	model,
	showHeader = true,
	remoteSection,
}: RemoteMcpSectionViewProps): JSX.Element {
	// 发现页也展示已添加项（卡片标「已添加」），不再过滤。
	const visibleItems = useMemo(() => model.items ?? [], [model.items]);

	return (
		<div
			id={remoteSection.id}
			data-setting-section-id={remoteSection.id}
			data-setting-section-highlight-target={remoteSection.id}
		>
			{showHeader && (
				<div className="mb-3 flex items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-[12px] font-medium text-foreground">{labels.remoteListTitle}</div>
						<p className="mt-0.5 text-[11px] text-muted-foreground">{labels.remoteSupport}</p>
					</div>
					<Button variant="ghost" size="sm" onClick={model.load} disabled={model.loading} className="shrink-0">
						<span className={cn("icon-[mdi--refresh] mr-1 h-3.5 w-3.5", model.loading && "animate-spin")} />
						{labels.refresh}
					</Button>
				</div>
			)}
			{model.loading && (
				<div className="rounded-xl bg-card px-5 py-6 text-center text-[12px] text-muted-foreground">
					{labels.loading}
				</div>
			)}
			{!model.loading && model.error && (
				<div className="rounded-xl bg-destructive/10 px-5 py-4 text-center text-[12px] text-destructive">
					{model.error}
				</div>
			)}
			{!model.loading && !model.error && visibleItems.length === 0 && (
				<div className="rounded-xl bg-card px-5 py-6 text-center text-[12px] text-muted-foreground">
					{labels.noRemoteMcp}
				</div>
			)}
			{!model.loading && !model.error && visibleItems.length > 0 && (
				<div className={GRID_CLASS}>
					{visibleItems.map((server) => (
						<RemoteMcpCard
							key={server.id}
							server={server}
							added={addedNames.has(server.name)}
							busy={model.busy === server.name}
							discover={discover}
							labels={labels}
							onAction={model.handleAction}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function RemoteMcpCard({
	server,
	added,
	busy,
	discover,
	labels,
	onAction,
}: {
	server: RemoteMcpServerRowView;
	added: boolean;
	busy: boolean;
	discover: boolean;
	labels: RemoteMcpSectionViewLabels;
	onAction: (server: RemoteMcpServerRowView, action: "add" | "remove") => Promise<void>;
}): JSX.Element {
	const title = server.display_name || server.name;
	const iconSrc = server.icon?.trim() || "";
	const [failedIcon, setFailedIcon] = useState<string | null>(null);
	const showImg = Boolean(iconSrc) && failedIcon !== iconSrc;

	return (
		<div
			className={`group flex flex-col overflow-hidden rounded-xl transition-colors duration-200 ${
				added
					? "bg-card ring-1 ring-inset ring-emerald-500/20 hover:bg-accent"
					: "bg-card hover:bg-accent"
			}`}
		>
			<div className="flex flex-1 flex-col gap-2.5 p-3.5">
				<div className="flex items-start gap-2.5">
					{showImg ? (
						<img
							src={iconSrc}
							alt=""
							className="h-10 w-10 shrink-0 rounded-lg object-contain"
							onError={() => setFailedIcon(iconSrc)}
						/>
					) : (
						<McpDefaultIcon className="h-10 w-10 rounded-lg" />
					)}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-1.5">
							<h4 className="truncate text-[13px] font-semibold tracking-tight text-foreground">{title}</h4>
							{added && (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
									{labels.added}
								</span>
							)}
						</div>
						{server.description ? (
							<p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
								{server.description}
							</p>
						) : (
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground/45">{server.name}</p>
						)}
					</div>
				</div>

				<div className="mt-auto flex justify-end pt-1">
					{added ? (
						discover ? (
							<Button variant="outline" size="sm" disabled className="opacity-80">
								<span className="icon-[mdi--check] h-3.5 w-3.5 text-emerald-400" />
								{labels.added}
							</Button>
						) : (
							<Button variant="ghost" size="sm" disabled={busy} onClick={() => void onAction(server, "remove")}>
								{busy ? labels.processing : labels.remove}
							</Button>
						)
					) : (
						<Button variant="primary" size="sm" disabled={busy} onClick={() => void onAction(server, "add")}>
							{busy ? labels.processing : labels.add}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
