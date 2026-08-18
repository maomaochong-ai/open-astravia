import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "remove-provider"; provider: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "remove-provider" || typeof r.provider !== "string") return null;
	return { operation: "remove-provider", provider: r.provider };
}

export function ModelsRemoveProviderApproval(): JSX.Element | null {
	const approval = useActionApproval("models.remove-provider");
	if (!approval) return null;
	return <ModelsRemoveProviderApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ModelsRemoveProviderApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--server-remove]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.models.ops.remove-provider.title")}
			summary={t("manageApproval.models.ops.remove-provider.summary")}
			icon={icon}
			badge={t("manageApproval.models.ops.remove-provider.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.models.ops.remove-provider.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--cloud-outline]" title={input.provider} subtitle={t("manageApproval.fields.provider")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.models.ops.remove-provider.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.models.ops.remove-provider.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
