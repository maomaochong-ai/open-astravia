import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "unarchive"; path: string; name?: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "unarchive" || typeof r.path !== "string") return null;
	return r as unknown as Input;
}

export function ProjectsUnarchiveApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.unarchive");
	if (!approval) return null;
	return <ProjectsUnarchiveApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ProjectsUnarchiveApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--archive-arrow-up-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.projects.ops.unarchive.title")}
			summary={t("manageApproval.projects.ops.unarchive.summary")}
			icon={icon}
			badge={t("manageApproval.projects.ops.unarchive.badge")}
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.unarchive.confirm"))}
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
						description={t("manageApproval.projects.ops.unarchive.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
