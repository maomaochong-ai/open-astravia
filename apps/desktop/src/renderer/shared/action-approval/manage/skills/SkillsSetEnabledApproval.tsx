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
	operation: "set-enabled";
	name: string;
	enabled: boolean;
	approvalUi?: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-enabled" || typeof r.name !== "string" || typeof r.enabled !== "boolean") {
		return null;
	}
	return {
		operation: "set-enabled",
		name: r.name,
		enabled: r.enabled,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function SkillsSetEnabledApproval(): JSX.Element | null {
	const approval = useActionApproval("skills.set-enabled");
	if (!approval) return null;
	return <SkillsSetEnabledApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function SkillsSetEnabledApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [enabled, setEnabled] = useState(input?.enabled ?? true);
	const copy = getToggleApprovalCopy(t, "skills", enabled);
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
							operation: "set-enabled",
							name: input.name,
							enabled,
							approvalUi: input.approvalUi ?? "skills.set-enabled",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalToggleIntentCard
						targetIcon="icon-[mdi--puzzle-outline]"
						targetTitle={input.name}
						targetSubtitle={t("manageApproval.fields.skillName")}
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
