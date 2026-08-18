import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "uninstall"; name: string; type?: "skill" | "scene"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "uninstall" || typeof r.name !== "string") return null;
	return r as unknown as Input;
}

export function SkillsUninstallApproval(): JSX.Element | null {
	const approval = useActionApproval("skills.uninstall");
	if (!approval) return null;
	return <SkillsUninstallApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function SkillsUninstallApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--puzzle-remove-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.skills.ops.uninstall.title")}
			summary={t("manageApproval.skills.ops.uninstall.summary")}
			icon={icon}
			badge={t("manageApproval.skills.ops.uninstall.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.skills.ops.uninstall.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--puzzle-outline]" title={input.name} subtitle={input.type ?? t("manageApproval.fields.skillName")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.skills.ops.uninstall.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.skills.ops.uninstall.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
