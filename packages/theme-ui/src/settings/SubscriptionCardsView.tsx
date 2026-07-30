import { cn } from "@vetta/ui";
import type { JSX, ReactNode } from "react";

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
		expiryDate: (date: string) => string;
		freeModel: string;
		modelMultiplier: (value: string) => string;
		refresh: string;
		refreshing: string;
		thinking: string;
		unlimitedQuota: string;
		updated: string;
		upgrade?: string;
		vision: string;
	};
	now: number;
	refreshing: boolean;
	showGoCard: boolean;
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

function QuotaWindows({
	model,
	unlimited,
}: {
	model: SubscriptionCardsViewModel;
	unlimited: boolean;
}): JSX.Element | null {
	if (unlimited) {
		return (
			<div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-[13px] font-medium text-foreground">
				<span className="icon-[solar--infinity-linear] h-4 w-4 shrink-0 text-primary" />
				{model.labels.unlimitedQuota}
			</div>
		);
	}
	if (model.windows.length === 0) return null;

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,148px),1fr))] gap-x-5 gap-y-3">
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

function ModelRow({
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
		<div className="flex items-center gap-3 py-1.5">
			<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
				{model.name || model.id}
			</span>
			<div className="flex shrink-0 items-center gap-1 text-[10px]">
				{showMultiplier && mul && (
					<span className="flex items-center gap-1 text-muted-foreground">
						<span className="icon-[solar--layers-minimalistic-linear] h-3 w-3 shrink-0 opacity-70" />
						<span className="tabular-nums">{labels.modelMultiplier(formatMultiplier(mul.input))}</span>
					</span>
				)}
				{isFree && <span className="rounded bg-accent px-1 py-0.5 text-muted-foreground">{labels.freeModel}</span>}
				{model.tags?.map((tag) => (
					<span key={tag} className="rounded bg-accent px-1 py-0.5 text-muted-foreground">
						{tag.trim()}
					</span>
				))}
				{model.input?.includes("image") && (
					<span className="rounded bg-primary/10 px-1 py-0.5 text-primary">{labels.vision}</span>
				)}
				{model.reasoning && (
					<span className="rounded bg-primary/10 px-1 py-0.5 text-primary">{labels.thinking}</span>
				)}
			</div>
		</div>
	);
}

function ModelsList({ model }: { model: SubscriptionCardsViewModel }): JSX.Element | null {
	const models = model.goProvider?.models ?? [];
	if (models.length === 0) return null;

	return (
		<div className="divide-y divide-border/40">
			{models.map((remoteModel) => (
				<ModelRow key={remoteModel.id} model={remoteModel} labels={model.labels} />
			))}
		</div>
	);
}

function VettaGoCard({
	model,
	beforeWindows,
	children,
}: {
	model: SubscriptionCardsViewModel;
	beforeWindows?: ReactNode;
	children?: ReactNode;
}): JSX.Element {
	const unlimited = model.windows.length > 0 && model.windows.every((windowInfo) => windowInfo.limit <= 0);

	return (
		<div className="flex flex-col gap-4">
			{model.expiry && (
				<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<span className="icon-[solar--calendar-linear] h-3.5 w-3.5 shrink-0" />
					{model.labels.expiryDate(model.expiry)}
				</div>
			)}

			{beforeWindows}

			<QuotaWindows model={model} unlimited={unlimited} />

			{children ? <div>{children}</div> : null}

			<ModelsList model={model} />
		</div>
	);
}

export function SubscriptionCardsView({
	model,
	beforeWindows,
	children,
}: {
	model: SubscriptionCardsViewModel;
	/** Rendered above the quota windows (e.g. usage stat tiles). */
	beforeWindows?: ReactNode;
	/** Rendered between quota windows and models (e.g. embedded token usage chart). */
	children?: ReactNode;
}): JSX.Element | null {
	if (!model.showGoCard) {
		// No Go plan card to nest into: still surface whatever was passed in.
		return beforeWindows || children ? (
			<div className="flex flex-col gap-4">
				{beforeWindows}
				{children}
			</div>
		) : null;
	}
	return (
		<VettaGoCard model={model} beforeWindows={beforeWindows}>
			{children}
		</VettaGoCard>
	);
}
