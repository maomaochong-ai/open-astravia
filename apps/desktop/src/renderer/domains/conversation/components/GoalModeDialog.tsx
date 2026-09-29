import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@vetta-org/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGoalModeModel } from "../hooks/useGoalModeModel";

export function GoalModeDialog(): JSX.Element | null {
	const { t } = useTranslation("chat");
	const goal = useGoalModeModel();
	const [objective, setObjective] = useState("");

	useEffect(() => {
		if (!goal.open) return;
		if (!goal.state || goal.state.status === "complete") setObjective("");
	}, [goal.open, goal.state]);

	if (!goal.open) return null;
	const canCreate = !goal.state || goal.state.status === "complete";
	const canResume = goal.state && ["paused", "blocked", "usage_limited"].includes(goal.state.status);

	return (
		<Dialog open onOpenChange={goal.setOpen}>
			<DialogContent className="max-w-[520px]">
				<DialogHeader>
					<DialogTitle>{t("goalMode.dialog.title")}</DialogTitle>
					<DialogDescription>
						{canCreate ? t("goalMode.dialog.createDescription") : t("goalMode.dialog.manageDescription")}
					</DialogDescription>
				</DialogHeader>

				{canCreate ? (
					<div className="flex flex-col gap-3">
						<label className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-foreground">{t("goalMode.dialog.objectiveLabel")}</span>
							<Textarea
								value={objective}
								onChange={(event) => setObjective(event.target.value)}
								placeholder={t("goalMode.dialog.objectivePlaceholder")}
								aria-label={t("goalMode.dialog.objectiveLabel")}
								className="min-h-28"
							/>
						</label>
					</div>
				) : goal.state ? (
					<div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
						<div>
							<div className="text-[11px] text-muted-foreground">{t("goalMode.dialog.statusLabel")}</div>
							<div className="text-[13px] font-medium text-foreground">
								{t(`goalMode.status.${goal.state.status}`)}
							</div>
						</div>
						<p className="whitespace-pre-wrap text-[13px] text-foreground">{goal.state.objective}</p>
						<div className="text-[11px] text-muted-foreground">
							{t("goalMode.dialog.usage", {
								used: goal.state.tokensUsed,
								count: goal.state.continuationCount,
							})}
						</div>
					</div>
				) : null}

				<DialogFooter>
					<Button variant="outline" onClick={() => goal.setOpen(false)} disabled={goal.busy}>
						{t("goalMode.dialog.cancel")}
					</Button>
					{goal.state && !canCreate ? (
						<Button variant="outline" onClick={() => void goal.clear()} disabled={goal.busy}>
							{t("goalMode.dialog.clear")}
						</Button>
					) : null}
					{canResume ? (
						<Button variant="primary" onClick={() => void goal.resume()} disabled={goal.busy}>
							{t("goalMode.dialog.resume")}
						</Button>
					) : null}
					{canCreate ? (
						<Button
							variant="primary"
							disabled={goal.busy || objective.trim().length === 0}
							onClick={() => void goal.start(objective)}
						>
							{t("goalMode.dialog.start")}
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
