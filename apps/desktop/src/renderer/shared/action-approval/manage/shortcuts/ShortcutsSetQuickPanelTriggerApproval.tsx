import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalSettingGroup,
	ApprovalSettingRow,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
import {
	QUICK_PANEL_APPROVAL_ICON,
	QUICK_PANEL_TRIGGERS,
	type QuickPanelTrigger,
} from "./shortcutsApprovalShared";

interface InputData {
	operation: "set-quick-panel-trigger";
	trigger: QuickPanelTrigger;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-quick-panel-trigger") return null;
	if (r.trigger !== "none" && r.trigger !== "mod" && r.trigger !== "alt" && r.trigger !== "shift") return null;
	return {
		operation: "set-quick-panel-trigger",
		trigger: r.trigger,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ShortcutsSetQuickPanelTriggerApproval(): JSX.Element | null {
	const approval = useActionApproval("shortcuts.set-quick-panel-trigger");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [trigger, setTrigger] = useState<QuickPanelTrigger>(input?.trigger ?? "none");

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.shortcuts.ops.set-quick-panel-trigger.title")}
			summary={t("manageApproval.shortcuts.ops.set-quick-panel-trigger.summary")}
			icon={QUICK_PANEL_APPROVAL_ICON}
			badge={t("manageApproval.shortcuts.ops.set-quick-panel-trigger.badge")}
			labels={frameLabels(request.permission, t("manageApproval.shortcuts.ops.set-quick-panel-trigger.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-quick-panel-trigger",
							trigger,
							approvalUi: input.approvalUi ?? "shortcuts.set-quick-panel-trigger",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.shortcuts.quickPanelTriggerSectionTitle")}
						description={t("manageApproval.shortcuts.quickPanelTriggerSectionDescription")}
					>
						<ApprovalSettingRow
							title={t("manageApproval.fields.quickpanelTrigger")}
							description={t(`manageApproval.shortcuts.quickPanelTriggerHints.${trigger}`)}
							border={false}
						>
							<Select value={trigger} onValueChange={(value) => setTrigger(value as QuickPanelTrigger)}>
								<SelectTrigger
									size="sm"
									className="h-8 min-w-[150px] border-border/70 bg-background/50 text-[12px]"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{QUICK_PANEL_TRIGGERS.map((candidate) => (
										<SelectItem key={candidate} value={candidate} className="text-[12px]">
											{t(`manageApproval.shortcuts.quickPanelTriggers.${candidate}`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</ApprovalSettingRow>
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon={QUICK_PANEL_APPROVAL_ICON}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.shortcuts.ops.set-quick-panel-trigger.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
