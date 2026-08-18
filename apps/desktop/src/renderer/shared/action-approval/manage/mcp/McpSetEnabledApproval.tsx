import { useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { getToggleApprovalCopy, getToggleSharedLabels } from "../../approvalToggleCopy";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalToggleIntentCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface McpSetEnabledInput {
	operation: "set-enabled";
	name: string;
	enabled: boolean;
	approvalUi?: string;
}

function parseInput(input: unknown): McpSetEnabledInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	if (
		record.operation !== "set-enabled" ||
		typeof record.name !== "string" ||
		typeof record.enabled !== "boolean"
	) {
		return null;
	}
	return {
		operation: "set-enabled",
		name: record.name,
		enabled: record.enabled,
		approvalUi: typeof record.approvalUi === "string" ? record.approvalUi : undefined,
	};
}

export function McpSetEnabledApproval(): JSX.Element | null {
	const approval = useActionApproval("mcp.set-enabled");
	if (!approval) return null;
	return <McpSetEnabledApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function McpSetEnabledApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [enabled, setEnabled] = useState(input?.enabled ?? true);
	const copy = getToggleApprovalCopy(t, "mcp", enabled);
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
							approvalUi: input.approvalUi ?? "mcp.set-enabled",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalToggleIntentCard
						targetIcon="icon-[mdi--server-network]"
						targetTitle={input.name}
						targetSubtitle={t("manageApproval.fields.serverName")}
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
