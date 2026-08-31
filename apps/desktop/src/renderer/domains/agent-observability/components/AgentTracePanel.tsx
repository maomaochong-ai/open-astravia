import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentTraces } from "../hooks/useAgentTraces";
import { orderTraceRows } from "../services/trace-rows";

export function AgentTracePanel({ sessionId }: { readonly sessionId: string }): JSX.Element {
	const { t, i18n } = useTranslation("chat");
	const id = useId();
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [turnId, setTurnId] = useState("");
	const [turnFilter, setTurnFilter] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const { page, loading, error, loadMore, refresh } = useAgentTraces(sessionId, errorsOnly, turnFilter);
	return (
		<div className="space-y-3">
			<p className="text-[12px] text-muted-foreground">{t("agentTraces.privacy")}</p>
			<div className="flex flex-wrap items-end gap-2">
				<div className="min-w-0 flex-1 space-y-1">
					<label htmlFor={`${id}-turn`} className="text-[12px]">
						{t("agentTraces.turnFilter")}
					</label>
					<Input id={`${id}-turn`} value={turnId} maxLength={256} onChange={(event) => setTurnId(event.target.value)} />
				</div>
				<Button variant="outline" size="sm" onClick={() => setTurnFilter(turnId)}>
					{t("agentTraces.filter")}
				</Button>
				<Button variant="outline" size="sm" aria-pressed={errorsOnly} onClick={() => setErrorsOnly(!errorsOnly)}>
					{t("agentTraces.errorsOnly")}
				</Button>
				<Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
					{t("agentTraces.refresh")}
				</Button>
			</div>
			{page?.health.issue && (
				<p role="status" className="text-[12px] text-amber-400">
					{t("agentTraces.degraded", { code: page.health.issue })}
				</p>
			)}
			{!!page?.health.dropped && (
				<p className="text-[12px] text-muted-foreground">{t("agentTraces.dropped", { count: page.health.dropped })}</p>
			)}
			{error && (
				<p role="alert" className="text-[12px] text-destructive">
					{t("agentTraces.error")}
				</p>
			)}
			{loading && (
				<p role="status" className="text-[12px] text-muted-foreground">
					{t("agentTraces.loading")}
				</p>
			)}
			{!loading && !error && page?.records.length === 0 && (
				<p className="py-6 text-center text-[13px] text-muted-foreground">{t("agentTraces.empty")}</p>
			)}
			<div className="space-y-2">
				{orderTraceRows(page?.records ?? []).map(({ record, depth }) => (
					<div
						key={record.id}
						style={{ marginLeft: depth * 12 }}
						className="min-w-0 rounded-lg border border-border/50"
					>
						<Button
							variant="ghost"
							className="h-auto w-full justify-between gap-3 whitespace-normal px-3 py-2 text-left"
							aria-expanded={expanded === record.id}
							onClick={() => setExpanded(expanded === record.id ? null : record.id)}
						>
							<span className="min-w-0 break-all text-[12px]">
								<span className="text-muted-foreground">{t(`agentTraces.kind.${record.kind}`)} · </span>
								{record.name}
							</span>
							<span className="shrink-0 text-right text-[11px] text-muted-foreground">
								{t(`agentTraces.state.${record.state}`)}
								<br />
								{record.endedAt === undefined
									? "—"
									: t("agentTraces.duration", { count: Math.round(record.endedAt - record.startedAt) })}
							</span>
						</Button>
						{expanded === record.id && (
							<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-border/50 p-3 text-[11px]">
								<dt>{t("agentTraces.time")}</dt>
								<dd>{new Date(record.startedAt).toLocaleString(i18n.language)}</dd>
								<dt>{t("agentTraces.traceId")}</dt>
								<dd className="break-all select-text">{record.traceId}</dd>
								<dt>{t("agentTraces.spanId")}</dt>
								<dd className="break-all select-text">{record.id}</dd>
								{(["agentId", "revisionId", "instanceId", "sessionId", "turnId", "modelCallId", "toolCallId"] as const)
									.filter((key) => record.context[key] !== undefined)
									.map((key) => (
										<div key={key} className="contents">
											<dt>{t(`agentTraces.identity.${key}`)}</dt>
											<dd className="break-all select-text">{record.context[key]}</dd>
										</div>
									))}
								{record.metadata.configurationRevision !== undefined && (
									<>
										<dt>{t("agentTraces.configurationRevision")}</dt>
										<dd>{record.metadata.configurationRevision}</dd>
									</>
								)}
								{record.usage.totalTokens !== undefined && (
									<>
										<dt>{t("agentTraces.tokens")}</dt>
										<dd>{record.usage.totalTokens}</dd>
									</>
								)}
								<dt>{t("agentTraces.metadata")}</dt>
								<dd className="break-all select-text font-mono">
									{JSON.stringify({ metadata: record.metadata, usage: record.usage, cost: record.cost })}
								</dd>
							</dl>
						)}
					</div>
				))}
			</div>
			{page?.nextCursor && (
				<Button variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>
					{t("agentTraces.more")}
				</Button>
			)}
		</div>
	);
}
