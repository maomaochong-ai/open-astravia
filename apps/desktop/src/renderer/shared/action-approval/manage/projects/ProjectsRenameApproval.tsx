import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalFormField,
	ApprovalImpactCard,
	ApprovalRawFallback,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "rename";
	name?: string;
	path?: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "rename") return null;
	return r as unknown as InputData;
}

export function ProjectsRenameApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.rename");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [name, setName] = useState(input?.name ?? "");
	const [path, setPath] = useState(input?.path ?? "");

	const canApprove =
		name.trim().length > 0 && (path.trim().length > 0 || Boolean(input?.path));

	const onApprove = (): void => {
		if (!input) { approve(); return; }
		approve({
			operation: "rename",
			path: path.trim() || input.path || "",
			name: name.trim(),
			approvalUi: input.approvalUi ?? "projects.rename",
		});
	};

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.projects.ops.rename.title")}
			summary={t("manageApproval.projects.ops.rename.summary")}
			icon="icon-[mdi--folder-edit-outline]"
			badge={t("manageApproval.projects.ops.rename.badge")}
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.rename.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={onApprove}
			canApprove={canApprove}
		>
			{input ? (
				<>
					<ApprovalFormField id="projects-rename-name" label={t("manageApproval.fields.name")}>
						<Input id="projects-rename-name" value={name} onChange={(e) => setName(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="projects-rename-path" label={t("manageApproval.fields.path")}>
						<Input
							id="projects-rename-path"
							value={path}
							placeholder={undefined}
							onChange={(e) => setPath(e.target.value)}
							disabled={Boolean(input.path)}
						/>
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--folder-edit-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.projects.ops.rename.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
