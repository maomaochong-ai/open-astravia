import { useTranslation } from "react-i18next";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface McpRemoveInput {
	operation: "remove";
	name: string;
}

function parseInput(input: unknown): McpRemoveInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	if (record.operation !== "remove" || typeof record.name !== "string") return null;
	return { operation: "remove", name: record.name };
}

export function McpRemoveApproval(): JSX.Element | null {
	const approval = useActionApproval("mcp.remove");
	if (!approval) return null;
	return <McpRemoveApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function McpRemoveApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.mcp.ops.remove.title")}
			summary={t("manageApproval.mcp.ops.remove.summary")}
			icon="icon-[mdi--delete-outline]"
			badge={t("manageApproval.mcp.ops.remove.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.mcp.ops.remove.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--server-network]"
						title={input.name}
						subtitle={t("manageApproval.fields.serverName")}
					/>
					<ApprovalImpactCard
						icon="icon-[mdi--delete-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.mcp.ops.remove.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.mcp.ops.remove.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
