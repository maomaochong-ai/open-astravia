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
	QUICK_PANEL_BEHAVIORS,
	type QuickPanelBehavior,
} from "./shortcutsApprovalShared";

interface InputData {
	operation: "set-quick-panel-behavior";
	behavior: QuickPanelBehavior;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-quick-panel-behavior") return null;
	if (r.behavior !== "foreground" && r.behavior !== "background") return null;
	return {
		operation: "set-quick-panel-behavior",
		behavior: r.behavior,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ShortcutsSetQuickPanelBehaviorApproval(): JSX.Element | null {
	const approval = useActionApproval("shortcuts.set-quick-panel-behavior");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [behavior, setBehavior] = useState<QuickPanelBehavior>(input?.behavior ?? "foreground");

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.shortcuts.ops.set-quick-panel-behavior.title")}
			summary={t("manageApproval.shortcuts.ops.set-quick-panel-behavior.summary")}
			icon={QUICK_PANEL_APPROVAL_ICON}
			badge={t("manageApproval.shortcuts.ops.set-quick-panel-behavior.badge")}
			labels={frameLabels(request.permission, t("manageApproval.shortcuts.ops.set-quick-panel-behavior.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-quick-panel-behavior",
							behavior,
							approvalUi: input.approvalUi ?? "shortcuts.set-quick-panel-behavior",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.shortcuts.quickPanelBehaviorSectionTitle")}
						description={t("manageApproval.shortcuts.quickPanelBehaviorSectionDescription")}
					>
						<ApprovalSettingRow
							title={t("manageApproval.fields.quickpanelBehavior")}
							description={t(`manageApproval.shortcuts.quickPanelBehaviorHints.${behavior}`)}
							border={false}
						>
							<Select
								value={behavior}
								onValueChange={(value) => setBehavior(value as QuickPanelBehavior)}
							>
								<SelectTrigger
									size="sm"
									className="h-8 min-w-[150px] border-border/70 bg-background/50 text-[12px]"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{QUICK_PANEL_BEHAVIORS.map((candidate) => (
										<SelectItem key={candidate} value={candidate} className="text-[12px]">
											{t(`manageApproval.shortcuts.quickPanelBehaviors.${candidate}`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</ApprovalSettingRow>
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon={QUICK_PANEL_APPROVAL_ICON}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.shortcuts.ops.set-quick-panel-behavior.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
