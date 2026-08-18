import { useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { getToggleApprovalCopy, getToggleSharedLabels } from "../../approvalToggleCopy";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalToggleIntentCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input {
	operation: "set-notifications";
	enabled: boolean;
	approvalUi?: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-notifications" || typeof r.enabled !== "boolean") return null;
	return {
		operation: "set-notifications",
		enabled: r.enabled,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function GeneralSetNotificationsApproval(): JSX.Element | null {
	const approval = useActionApproval("general.set-notifications");
	if (!approval) return null;
	return <GeneralSetNotificationsApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function GeneralSetNotificationsApprovalContent({
	approval,
}: {
	approval: ActiveActionApproval;
}): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [enabled, setEnabled] = useState(input?.enabled ?? true);
	const copy = getToggleApprovalCopy(t, "general.notifications", enabled);
	const shared = getToggleSharedLabels(t);

	return (
		<Frame
			presentation="dialog"
			title={copy.title}
			summary={copy.summary}
			icon={copy.icon}
			badge={copy.badge}
			labels={frameLabels(request.permission, copy.confirm)}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-notifications",
							enabled,
							approvalUi: input.approvalUi ?? "general.set-notifications",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalToggleIntentCard
						targetIcon="icon-[mdi--bell-outline]"
						targetTitle={t("manageApproval.general.notificationsTarget")}
						targetSubtitle={t("manageApproval.general.notificationsTargetHint")}
						enabled={enabled}
						onEnabledChange={setEnabled}
						willBecomeLabel={shared.willBecome}
						stateOnLabel={shared.stateOn}
						stateOffLabel={shared.stateOff}
						stateHint={enabled ? shared.stateOnHint : shared.stateOffHint}
						editableHint={shared.editableHint}
					/>
					<ApprovalImpactCard
						icon={copy.icon}
						title={t("manageApproval.afterActionTitle")}
						description={copy.impact}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
