import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ContentPreparedRun } from "../agent/service";
import { getContentCreationAgentService, getContentCreationWorkspace } from "./runtime";
import {
	getPendingContentRunIds,
	resolveContentRunApproval,
	subscribeContentRunApprovals,
} from "./run-approval";

export function ContentRunApprovalDialog() {
	const { t } = useTranslation();
	const pendingRunIds = useSyncExternalStore(
		subscribeContentRunApprovals,
		getPendingContentRunIds,
		getPendingContentRunIds,
	);
	const runId = pendingRunIds[0];
	const [run, setRun] = useState<ContentPreparedRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);

	useEffect(() => {
		setError(null);
		setStarting(false);
		if (!runId) {
			setRun(null);
			return;
		}
		const agent = getContentCreationAgentService();
		const refresh = () => {
			const next = agent.getRun(runId);
			setRun(next);
			if (!next) resolveContentRunApproval(runId);
		};
		const unsubscribeRun = agent.subscribeRuns(refresh);
		const cwd = agent.getRun(runId)?.cwd;
		const unsubscribeProject = cwd ? getContentCreationWorkspace().subscribe(cwd, refresh) : () => undefined;
		refresh();
		return () => {
			unsubscribeRun();
			unsubscribeProject();
		};
	}, [runId]);

	const close = () => {
		if (!runId || starting) return;
		getContentCreationAgentService().cancelRun(runId);
		resolveContentRunApproval(runId);
	};

	return (
		<Dialog open={Boolean(runId && run)} onOpenChange={(open) => !open && close()}>
			<DialogContent data-vetta-plugin-root="content-creation" className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("runApproval.title")}</DialogTitle>
					<DialogDescription>{t("runApproval.description")}</DialogDescription>
				</DialogHeader>
				{run ? (
					<div className="grid grid-cols-2 gap-2 text-sm">
						<RunMetric label={t("runApproval.project")} value={run.projectId} />
						<RunMetric label={t("runApproval.nodes")} value={String(run.nodeIds.length)} />
					</div>
				) : null}
				{pendingRunIds.length > 1 ? (
					<p className="text-xs text-muted-foreground">
						{t("runApproval.queued", { count: pendingRunIds.length - 1 })}
					</p>
				) : null}
				{error ? <p className="text-sm text-destructive">{error}</p> : null}
				<DialogFooter>
					<Button variant="ghost" disabled={starting} onClick={close}>
						{t("runApproval.cancel")}
					</Button>
					<Button
						disabled={!run || starting}
						onClick={() => {
							if (!runId) return;
							setStarting(true);
							setError(null);
							void getContentCreationAgentService()
								.startRun(runId)
								.then(() => resolveContentRunApproval(runId))
								.catch((startError: unknown) => {
									setStarting(false);
									setError(startError instanceof Error ? startError.message : String(startError));
								});
						}}
					>
						{starting ? t("runApproval.starting") : t("runApproval.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RunMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 truncate font-medium text-foreground">{value}</div>
		</div>
	);
}
