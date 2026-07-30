import { Button, cn } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export type ModelCost = { cacheRead: number; cacheWrite: number; input: number; output: number };
export type RemoteModel = {
	api?: string;
	contextWindow?: number;
	id: string;
	input?: string[];
	maxTokens?: number;
	multiplier?: ModelCost;
	name?: string;
	reasoning?: boolean;
	tags?: string[];
};
export type RemoteProvider = { api?: string; baseUrl?: string; icon?: string; models?: RemoteModel[] };

export interface SubscriptionWindowViewModel {
	consumed: number;
	kind: string;
	label: string;
	limit: number;
	resetAt: string;
}

export interface SubscriptionCardsViewModel {
	actions: {
		refresh: () => Promise<void>;
		/** 打开官网定价页外链（ADR-0051：desktop 不做站内支付，仅外链引流）。缺省不渲染按钮。 */
		upgrade?: () => void;
	};
	expiry: string | null;
	goProvider: RemoteProvider | undefined;
	labels: {
		currentPlan: string;
		expiryDate: (date: string) => string;
		freeModel: string;
		modelMultiplier: (value: string) => string;
		refresh: string;
		refreshing: string;
		thinking: string;
		tokenPlan: string;
		unlimitedQuota: string;
		updated: string;
		upgrade?: string;
		vision: string;
	};
	now: number;
	refreshing: boolean;
	showGoCard: boolean;
	status: {
		badge_color?: string | null;
		badge_text?: string | null;
		description?: string | null;
		tier_name?: string | null;
	};
	windows: SubscriptionWindowViewModel[];
}

function formatMultiplier(n: number): string {
	return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function formatWindowReset(resetAt: string, now: number): string {
	const ms = new Date(resetAt).getTime() - now;
	if (!Number.isFinite(ms) || ms <= 0) return "";
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (h > 0) return h + "h " + m + "m";
	return m + "m";
}

function VettaGoBrand({
	currentPlan,
	status,
}: {
	currentPlan: string;
	status: SubscriptionCardsViewModel["status"];
}): JSX.Element {
	return (
		<div className="flex items-center gap-3">
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
				<span className="icon-[solar--rocket-2-linear] h-4 w-4 text-primary" />
			</div>
			<div className="flex min-w-0 flex-col leading-tight">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-[15px] font-semibold text-foreground">Vetta Go</span>
					{status.badge_text && (
						<span
							className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary-foreground"
							style={{ backgroundColor: status.badge_color || "var(--primary)" }}
						>
							{status.badge_text}
						</span>
					)}
				</div>
				<span className="text-[11px] text-muted-foreground">{currentPlan}</span>
			</div>
		</div>
	);
}

function QuotaWindows({
	model,
	unlimited,
}: {
	model: SubscriptionCardsViewModel;
	unlimited: boolean;
}): JSX.Element | null {
	if (unlimited) {
		return (
			<div className="mt-4 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-[13px] font-medium text-foreground">
				<span className="icon-[solar--infinity-linear] h-4 w-4 shrink-0 text-primary" />
				{model.labels.unlimitedQuota}
			</div>
		);
	}
	if (model.windows.length === 0) return null;

	return (
		<div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,148px),1fr))] gap-x-5 gap-y-3">
			{model.windows.map((windowInfo) => {
				const pct =
					windowInfo.limit > 0
						? Math.min(100, Math.round((windowInfo.consumed / windowInfo.limit) * 100))
						: 0;
				const resetLabel = formatWindowReset(windowInfo.resetAt, model.now);
				return (
					<div key={windowInfo.kind} className="min-w-0">
						<div className="flex items-center justify-between gap-2 text-[12px]">
							<span className="truncate font-medium text-foreground">{windowInfo.label}</span>
							<span className="shrink-0 tabular-nums text-muted-foreground">{pct}%</span>
						</div>
						<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
							<div
								className="h-full rounded-full bg-primary transition-[width] duration-300"
								style={{ width: `${pct}%` }}
							/>
						</div>
						{resetLabel && (
							<div className="mt-1 text-[10px] text-muted-foreground">{resetLabel}</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function ModelChip({
	labels,
	model,
}: {
	labels: SubscriptionCardsViewModel["labels"];
	model: RemoteModel;
}): JSX.Element {
	const mul = model.multiplier;
	const showMultiplier = !!mul && (mul.input > 0 || mul.output > 0);
	const isFree = !!mul && mul.input === 0 && mul.output === 0;
	return (
		<div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 transition-colors duration-200 hover:border-border hover:bg-background/60">
			<div className="flex items-center gap-1.5">
				<span className="truncate text-[12px] font-medium text-foreground">{model.name || model.id}</span>
				{model.reasoning && (
					<span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
						{labels.thinking}
					</span>
				)}
			</div>
			{(model.input?.includes("image") || (model.tags?.length ?? 0) > 0) && (
				<div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
					{model.input?.includes("image") && (
						<span className="rounded bg-primary/10 px-1 py-0.5 text-primary">{labels.vision}</span>
					)}
					{model.tags?.map((tag) => (
						<span key={tag} className="rounded bg-accent px-1 py-0.5 text-muted-foreground">
							{tag.trim()}
						</span>
					))}
				</div>
			)}
			{showMultiplier && mul && (
				<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
					<span className="icon-[solar--layers-minimalistic-linear] h-3 w-3 shrink-0 opacity-70" />
					<span className="tabular-nums">{labels.modelMultiplier(formatMultiplier(mul.input))}</span>
				</div>
			)}
			{isFree && (
				<div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
					<span className="icon-[solar--layers-minimalistic-linear] h-3 w-3 shrink-0 opacity-70" />
					<span>{labels.freeModel}</span>
				</div>
			)}
		</div>
	);
}

function ModelsGrid({ model }: { model: SubscriptionCardsViewModel }): JSX.Element | null {
	const models = model.goProvider?.models ?? [];
	if (models.length === 0) return null;

	return (
		<div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
			{models.map((remoteModel) => (
				<ModelChip key={remoteModel.id} model={remoteModel} labels={model.labels} />
			))}
		</div>
	);
}

function VettaGoCard({
	model,
	children,
}: {
	model: SubscriptionCardsViewModel;
	children?: ReactNode;
}): JSX.Element {
	const [showDone, setShowDone] = useState(false);
	const prevRefreshing = useRef(model.refreshing);
	const unlimited = model.windows.length > 0 && model.windows.every((windowInfo) => windowInfo.limit <= 0);
	const refreshLabel = showDone
		? model.labels.updated
		: model.refreshing
			? model.labels.refreshing
			: model.labels.refresh;

	useEffect(() => {
		if (prevRefreshing.current && !model.refreshing) {
			setShowDone(true);
			const timer = setTimeout(() => setShowDone(false), 1600);
			prevRefreshing.current = model.refreshing;
			return () => clearTimeout(timer);
		}
		prevRefreshing.current = model.refreshing;
	}, [model.refreshing]);

	return (
		<div className="mb-6 rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
			<div className="flex items-start justify-between gap-3">
				<VettaGoBrand currentPlan={model.labels.currentPlan} status={model.status} />
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => void model.actions.refresh()}
						disabled={model.refreshing}
						title={refreshLabel}
						aria-label={refreshLabel}
						className={cn("h-7 w-7 shrink-0", showDone && "text-emerald-400")}
					>
						{showDone ? (
							<span className="icon-[solar--check-circle-linear] h-3.5 w-3.5" />
						) : (
							<span
								className={cn(
									"icon-[solar--refresh-linear] h-3.5 w-3.5",
									model.refreshing && "animate-spin",
								)}
							/>
						)}
					</Button>
					{model.actions.upgrade && model.labels.upgrade ? (
						<Button
							type="button"
							variant="default"
							size="sm"
							onClick={() => model.actions.upgrade?.()}
							className="h-7 gap-1.5 px-2 text-[12px] font-medium"
						>
							<span className="icon-[solar--course-up-linear] h-3.5 w-3.5" />
							{model.labels.upgrade}
						</Button>
					) : null}
				</div>
			</div>

			<div className="mt-3 text-[12px] text-muted-foreground">
				{model.status.description || model.status.tier_name || model.labels.tokenPlan}
			</div>

			{model.expiry && (
				<div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<span className="icon-[solar--calendar-linear] h-3.5 w-3.5 shrink-0" />
					{model.labels.expiryDate(model.expiry)}
				</div>
			)}

			<QuotaWindows model={model} unlimited={unlimited} />

			{children ? <div className="mt-4">{children}</div> : null}

			<ModelsGrid model={model} />
		</div>
	);
}

export function SubscriptionCardsView({
	model,
	children,
}: {
	model: SubscriptionCardsViewModel;
	/** Rendered between quota windows and models (e.g. embedded token usage chart). */
	children?: ReactNode;
}): JSX.Element | null {
	if (!model.showGoCard) {
		// Standalone chrome when there is no Go plan card to nest into.
		return children ? (
			<div className="mb-6 rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm">
				{children}
			</div>
		) : null;
	}
	return <VettaGoCard model={model}>{children}</VettaGoCard>;
}
