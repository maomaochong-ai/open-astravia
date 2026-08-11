import { type PluginCardProps, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type ReactNode, useEffect, useState } from "react";
import type { ContentOperationPreview, ContentPreparedRun } from "../agent/service";
import { getContentCreationAgentService, getContentCreationWorkspace } from "./runtime";

export function ContentChangePreviewCard({ descriptor, pending }: PluginCardProps) {
	const { t } = useTranslation();
	const preview = parseContentOperationPreview(descriptor.payload);
	const [status, setStatus] = useState<"idle" | "applying" | "applied" | "error">("idle");
	const [error, setError] = useState<string | null>(null);
	// 工具执行中不展示占位；有 preview payload 后再渲染确认卡片。
	if (pending || !preview) return null;
	const diff = preview.diff;
	return (
		<CardShell>
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="text-sm font-medium">{t("card.preview.title")}</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{t("card.preview.revision", { revision: preview.expectedRevision })}
					</div>
				</div>
				{preview.destructive ? (
					<span className="rounded-full bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
						{t("card.preview.destructive")}
					</span>
				) : null}
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
				<Metric label={t("card.preview.nodesAdded")} value={diff.addedNodeIds.length} />
				<Metric label={t("card.preview.nodesUpdated")} value={diff.updatedNodeIds.length} />
				<Metric label={t("card.preview.nodesRemoved")} value={diff.removedNodeIds.length} />
				<Metric label={t("card.preview.connectionsChanged")} value={diff.addedEdgeCount + diff.removedEdgeCount} />
			</div>
			{error ? <div className="mt-3 text-xs text-destructive">{error}</div> : null}
			<div className="mt-3 flex justify-end">
				<Button
					size="sm"
					disabled={status !== "idle"}
					onClick={() => {
						setStatus("applying");
						setError(null);
						void getContentCreationAgentService()
							.commitPreview(preview.token)
							.then(() => setStatus("applied"))
							.catch((applyError: unknown) => {
								setStatus("error");
								setError(applyError instanceof Error ? applyError.message : String(applyError));
							});
					}}
				>
					{status === "applying"
						? t("card.preview.applying")
						: status === "applied"
							? t("card.preview.applied")
							: t("card.preview.confirm")}
				</Button>
			</div>
		</CardShell>
	);
}

export function ContentRunCard({ descriptor, pending }: PluginCardProps) {
	const { t } = useTranslation();
	const runId = parseRunId(descriptor.payload);
	const [run, setRun] = useState<ContentPreparedRun | null>(() =>
		runId ? getContentCreationAgentService().getRun(runId) : null,
	);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!runId) return;
		const agent = getContentCreationAgentService();
		const refresh = () => setRun(agent.getRun(runId));
		const unsubscribeRun = agent.subscribeRuns(refresh);
		const cwd = agent.getRun(runId)?.cwd;
		const unsubscribeProject = cwd ? getContentCreationWorkspace().subscribe(cwd, refresh) : () => undefined;
		refresh();
		return () => {
			unsubscribeRun();
			unsubscribeProject();
		};
	}, [runId]);

	if (pending) return <CardShell>{t("card.run.preparing")}</CardShell>;
	if (!runId || !run) return null;
	const completed = run.completedNodeIds.length;
	const total = run.nodeIds.length;
	return (
		<CardShell>
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="text-sm font-medium">{t("card.run.title")}</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{t("card.run.progress", { completed, total })}
					</div>
				</div>
				<span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
					{t(`card.run.status.${run.status}`)}
				</span>
			</div>
			<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-[width]"
					style={{ width: `${total === 0 ? 0 : Math.round(((completed + run.failedNodeIds.length) / total) * 100)}%` }}
				/>
			</div>
			{run.failedNodeIds.length > 0 ? (
				<div className="mt-2 text-xs text-destructive">
					{t("card.run.failed", { count: run.failedNodeIds.length })}
				</div>
			) : null}
			{error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
			<div className="mt-3 flex justify-end gap-2">
				{run.status === "awaiting-confirmation" ? (
					<Button
						size="sm"
						onClick={() => {
							setError(null);
							void getContentCreationAgentService().startRun(run.id).catch((startError: unknown) => {
								setError(startError instanceof Error ? startError.message : String(startError));
							});
						}}
					>
						{t("card.run.start")}
					</Button>
				) : null}
				{run.status === "running" ? (
					<Button size="sm" variant="outline" onClick={() => getContentCreationAgentService().cancelRun(run.id)}>
						{t("card.run.stop")}
					</Button>
				) : null}
			</div>
		</CardShell>
	);
}

function CardShell({ children }: { children: ReactNode }) {
	return <div className="rounded-xl border border-border bg-card p-4 text-card-foreground">{children}</div>;
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg bg-muted/50 px-2.5 py-2">
			<div>{label}</div>
			<div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
		</div>
	);
}

function parseContentOperationPreview(value: unknown): ContentOperationPreview | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	const diff = candidate.diff;
	if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;
	const diffCandidate = diff as Record<string, unknown>;
	if (
		typeof candidate.token !== "string" ||
		typeof candidate.projectId !== "string" ||
		typeof candidate.expectedRevision !== "number" ||
		typeof candidate.destructive !== "boolean" ||
		!isStringArray(diffCandidate.addedNodeIds) ||
		!isStringArray(diffCandidate.removedNodeIds) ||
		!isStringArray(diffCandidate.updatedNodeIds) ||
		typeof diffCandidate.addedEdgeCount !== "number" ||
		typeof diffCandidate.removedEdgeCount !== "number" ||
		typeof diffCandidate.workflowChanged !== "boolean"
	) {
		return null;
	}
	return candidate as unknown as ContentOperationPreview;
}

function parseRunId(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const runId = (value as Record<string, unknown>).runId;
	return typeof runId === "string" && runId.length > 0 ? runId : null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
