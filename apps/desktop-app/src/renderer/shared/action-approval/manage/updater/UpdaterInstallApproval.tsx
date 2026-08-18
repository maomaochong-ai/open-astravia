import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "install"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "install") return null;
	return { operation: "install" };
}

export function UpdaterInstallApproval(): JSX.Element | null {
	const approval = useActionApproval("updater.install");
	if (!approval) return null;
	return <UpdaterInstallApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function UpdaterInstallApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--update]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.updater.ops.install.title")}
			summary={t("manageApproval.updater.ops.install.summary")}
			icon={icon}
			badge={t("manageApproval.updater.ops.install.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.updater.ops.install.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--update]" title={t("manageApproval.updater.ops.install.badge")} subtitle={t("manageApproval.updater.target")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.updater.ops.install.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.updater.ops.install.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
