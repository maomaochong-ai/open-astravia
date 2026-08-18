import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "archive"; path: string; name?: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "archive" || typeof r.path !== "string") return null;
	return r as unknown as Input;
}

export function ProjectsArchiveApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.archive");
	if (!approval) return null;
	return <ProjectsArchiveApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ProjectsArchiveApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--archive-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.projects.ops.archive.title")}
			summary={t("manageApproval.projects.ops.archive.summary")}
			icon={icon}
			badge={t("manageApproval.projects.ops.archive.badge")}
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.archive.confirm"))}
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
						description={t("manageApproval.projects.ops.archive.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
