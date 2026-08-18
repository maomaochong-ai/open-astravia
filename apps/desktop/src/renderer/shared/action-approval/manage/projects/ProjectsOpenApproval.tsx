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
	operation: "open";
	name?: string;
	path?: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "open") return null;
	return r as unknown as InputData;
}

export function ProjectsOpenApproval(): JSX.Element | null {
	const approval = useActionApproval("projects.open");
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
		path.trim().length > 0;

	const onApprove = (): void => {
		if (!input) { approve(); return; }
		approve({
			operation: "open",
			path: path.trim(),
			...(name.trim() ? { name: name.trim() } : {}),
			approvalUi: input.approvalUi ?? "projects.open",
		});
	};

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.projects.ops.open.title")}
			summary={t("manageApproval.projects.ops.open.summary")}
			icon="icon-[mdi--folder-open-outline]"
			badge={t("manageApproval.projects.ops.open.badge")}
			labels={frameLabels(request.permission, t("manageApproval.projects.ops.open.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={onApprove}
			canApprove={canApprove}
		>
			{input ? (
				<>
					<ApprovalFormField id="projects-open-name" label={t("manageApproval.fields.name")}>
						<Input id="projects-open-name" value={name} onChange={(e) => setName(e.target.value)} />
					</ApprovalFormField>
					<ApprovalFormField id="projects-open-path" label={t("manageApproval.fields.path")}>
						<Input
							id="projects-open-path"
							value={path}
							placeholder={undefined}
							onChange={(e) => setPath(e.target.value)}
							disabled={false}
						/>
					</ApprovalFormField>
					<ApprovalImpactCard
						icon="icon-[mdi--folder-open-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.projects.ops.open.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
