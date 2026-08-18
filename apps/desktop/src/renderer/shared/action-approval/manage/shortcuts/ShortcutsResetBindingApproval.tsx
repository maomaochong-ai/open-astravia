import { useTranslation } from "react-i18next";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
import {
	formatShortcutDisplay,
	getShortcutActionDefault,
	isShortcutActionId,
	resolveShortcutActionId,
	SHORTCUT_ACTIONS,
	SHORTCUTS_APPROVAL_ICON,
} from "./shortcutsApprovalShared";

interface InputData {
	operation: "reset-binding";
	id: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "reset-binding" || typeof r.id !== "string") return null;
	return {
		operation: "reset-binding",
		id: r.id,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ShortcutsResetBindingApproval(): JSX.Element | null {
	const approval = useActionApproval("shortcuts.reset-binding");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { t: tSettings } = useTranslation("settings");
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const actionId = resolveShortcutActionId(input?.id);
	const def = SHORTCUT_ACTIONS.find((action) => action.id === actionId) ?? SHORTCUT_ACTIONS[0];
	const known = Boolean(input && isShortcutActionId(input.id));
	const defaultCombo = formatShortcutDisplay(getShortcutActionDefault(actionId));

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.shortcuts.ops.reset-binding.title")}
			summary={t("manageApproval.shortcuts.ops.reset-binding.summary")}
			icon={SHORTCUTS_APPROVAL_ICON}
			badge={t("manageApproval.shortcuts.ops.reset-binding.badge")}
			labels={frameLabels(request.permission, t("manageApproval.shortcuts.ops.reset-binding.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "reset-binding",
							id: known ? input.id : actionId,
							approvalUi: input.approvalUi ?? "shortcuts.reset-binding",
						})
					: approve()
			}
			canApprove={Boolean(input) && known}
		>
			{input && known ? (
				<>
					<ApprovalTargetCard
						icon={SHORTCUTS_APPROVAL_ICON}
						title={tSettings(def.labelKey)}
						subtitle={t("manageApproval.shortcuts.resetToDefault", { shortcut: defaultCombo })}
						subtitleMono={false}
					/>
					<ApprovalImpactCard
						icon={SHORTCUTS_APPROVAL_ICON}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.shortcuts.ops.reset-binding.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
