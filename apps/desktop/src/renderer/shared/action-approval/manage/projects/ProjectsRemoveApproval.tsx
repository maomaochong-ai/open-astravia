import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "remove"; path: string; name?: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "remove" || typeof r.path !== "string") return null;
	return r as unknown as Input;
}

export function ProjectsRemoveApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.remove");
	if (!approval) return null;
	return <ProjectsRemoveApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ProjectsRemoveApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--folder-remove-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.projects.ops.remove.title")}
			summary={t("manageApproval.projects.ops.remove.summary")}
			icon={icon}
			badge={t("manageApproval.projects.ops.remove.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.remove.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--folder-outline]" title={input.name ?? input.path} subtitle={input.path} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.projects.ops.remove.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.projects.ops.remove.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
