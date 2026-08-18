import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "download"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "download") return null;
	return { operation: "download" };
}

export function UpdaterDownloadApproval(): JSX.Element | null {
	const approval = useActionApproval("updater.download");
	if (!approval) return null;
	return <UpdaterDownloadApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function UpdaterDownloadApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--cloud-download-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.updater.ops.download.title")}
			summary={t("manageApproval.updater.ops.download.summary")}
			icon={icon}
			badge={t("manageApproval.updater.ops.download.badge")}
			labels={frameLabels(request.permission, t("manageApproval.updater.ops.download.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--cloud-download-outline]" title={t("manageApproval.updater.ops.download.badge")} subtitle={t("manageApproval.updater.target")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.updater.ops.download.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
