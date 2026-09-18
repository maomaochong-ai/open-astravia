import type { SubagentTask } from "@shared/store/subagents-atoms";
import { isSubagentActive, workflowDisplayName } from "@shared/store/subagents-atoms";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function SubagentReplyCard({ task }: { task: SubagentTask }): JSX.Element {
	const { t } = useTranslation("chat");
	const navigate = useNavigate();
	const name = workflowDisplayName(task);
	const canOpen = Boolean(task.sessionFile);
	return (
		<div data-testid="subagent-reply-card" className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-secondary px-3 py-2.5 dark:bg-input-bar-bg">
			<span className="icon-[solar--users-group-rounded-linear] h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold text-foreground/90">{name}</div>
				<div className="truncate text-[11px] text-muted-foreground">{t(`subagentCard.status.${task.status}`)}</div>
			</div>
			{isSubagentActive(task.status) ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" /> : null}
			<button
				type="button"
				disabled={!canOpen}
				aria-label={t("subagentCard.open", { name })}
				title={canOpen ? t("subagentCard.open", { name }) : t("subagentCard.waitingForSession")}
				onClick={() => {
					if (task.sessionFile) void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(task.sessionFile) }, search: { origin: "subagent" } });
				}}
				className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
			>
				<span className="icon-[solar--arrow-right-up-linear] h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	);
}
