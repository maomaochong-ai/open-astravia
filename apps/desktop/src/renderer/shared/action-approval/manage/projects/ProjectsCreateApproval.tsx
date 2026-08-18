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
	operation: "create";
	name?: string;
	path?: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "create") return null;
	return r as unknown as InputData;
}

export function ProjectsCreateApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.create");
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
		name.trim().length > 0;

	const onApprove = (): void => {
		if (!input) { approve(); return; }
		approve({
			operation: "create",
			name: name.trim(),
			...(path.trim() ? { path: path.trim() } : {}),
			approvalUi: input.approvalUi ?? "projects.create",
		});
	};

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.projects.ops.create.title")}
			summary={t("manageApproval.projects.ops.create.summary")}
			icon="icon-[mdi--folder-plus-outline]"
			badge={t("manageApproval.projects.ops.create.badge")}
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.create.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={onApprove}
			canApprove={canApprove}
		>
			{input ? (
				<>
					<ApprovalFormField id="projects-create-name" label={t("manageApproval.fields.name")}>
						<Input id="projects-create-name" value={name} onChange={(e) => setName(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="projects-create-path" label={t("manageApproval.fields.path")}>
						<Input
							id="projects-create-path"
							value={path}
							placeholder={t("manageApproval.projects.pathOptional")}
							onChange={(e) => setPath(e.target.value)}
							disabled={false}
						/>
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--folder-plus-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.projects.ops.create.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
