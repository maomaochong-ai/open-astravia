import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "set-workspace";
	path: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-workspace" || typeof r.path !== "string") return null;
	return r as unknown as InputData;
}

export function GeneralSetWorkspaceApproval(): JSX.Element | null {
	const approval = useActionApproval("general.set-workspace");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [path, setPath] = useState(input?.path ?? "");
	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.general.ops.set-workspace.title")}
			summary={t("manageApproval.general.ops.set-workspace.summary")}
			icon="icon-[mdi--folder-cog-outline]"
			badge={t("manageApproval.general.ops.set-workspace.badge")}
			labels={frameLabels(request.permission, t("manageApproval.general.ops.set-workspace.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-workspace",
							path: path.trim(),
							approvalUi: input.approvalUi ?? "general.set-workspace",
						})
					: approve()
			}
			canApprove={path.trim().length > 0}
		>
			{input ? (
				<>
					<ApprovalFormField id="general-workspace" label={t("manageApproval.fields.path")}>
						<Input id="general-workspace" value={path} onChange={(e) => setPath(e.target.value)} />
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--folder-cog-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.general.ops.set-workspace.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
