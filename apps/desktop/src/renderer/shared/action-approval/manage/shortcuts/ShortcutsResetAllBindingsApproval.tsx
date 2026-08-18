import { useTranslation } from "react-i18next";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalValueList,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
import {
	formatShortcutDisplay,
	SHORTCUT_ACTIONS,
	SHORTCUTS_APPROVAL_ICON,
} from "./shortcutsApprovalShared";

interface InputData {
	operation: "reset-all-bindings";
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "reset-all-bindings") return null;
	return {
		operation: "reset-all-bindings",
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ShortcutsResetAllBindingsApproval(): JSX.Element | null {
	const approval = useActionApproval("shortcuts.reset-all-bindings");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { t: tSettings } = useTranslation("settings");
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);

	const rows = SHORTCUT_ACTIONS.map((action) => ({
		label: tSettings(action.labelKey),
		value: formatShortcutDisplay(action.defaultShortcut),
	}));

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.shortcuts.ops.reset-all-bindings.title")}
			summary={t("manageApproval.shortcuts.ops.reset-all-bindings.summary")}
			icon={SHORTCUTS_APPROVAL_ICON}
			badge={t("manageApproval.shortcuts.ops.reset-all-bindings.badge")}
			labels={frameLabels(request.permission, t("manageApproval.shortcuts.ops.reset-all-bindings.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "reset-all-bindings",
							approvalUi: input.approvalUi ?? "shortcuts.reset-all-bindings",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalValueList rows={rows} />
					<ApprovalWarningCard>
						{t("manageApproval.shortcuts.ops.reset-all-bindings.warning")}
					</ApprovalWarningCard>
					<ApprovalImpactCard
						icon={SHORTCUTS_APPROVAL_ICON}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.shortcuts.ops.reset-all-bindings.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
