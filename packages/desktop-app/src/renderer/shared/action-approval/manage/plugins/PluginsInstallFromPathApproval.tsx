import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { ApprovalFormField, ApprovalImpactCard, ApprovalRawFallback } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";
import {
	buildInstallFromPathApprovalInput,
	type PluginInstallFromPathApprovalInput,
} from "./plugin-install-approval-input";

function parseInput(input: unknown): PluginInstallFromPathApprovalInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "install-from-path" || typeof r.path !== "string") return null;
	return r as unknown as PluginInstallFromPathApprovalInput;
}

export function PluginsInstallFromPathApproval(): JSX.Element | null {
	const approval = useActionApproval("plugins.install-from-path");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [path, setPath] = useState(input?.path ?? "");
	const npmDistribution =
		input?.source === "npm" &&
		input.npm &&
		typeof input.npm.packageName === "string" &&
		typeof input.npm.requestedSpec === "string"
			? input.npm
			: undefined;
	const operationKey = npmDistribution ? "install-from-npm" : "install-from-path";
	return (
		<Frame
			presentation="drawer"
			title={t(`manageApproval.plugins.ops.${operationKey}.title`)}
			summary={t(`manageApproval.plugins.ops.${operationKey}.summary`)}
			icon="icon-[mdi--folder-zip-outline]"
			badge={t(`manageApproval.plugins.ops.${operationKey}.badge`)}
			labels={frameLabels(request.permission, t(`manageApproval.plugins.ops.${operationKey}.confirm`))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve(buildInstallFromPathApprovalInput(input, path))
					: approve()
			}
			canApprove={path.trim().length > 0}
		>
			{input ? (
				<>
					{npmDistribution ? (
						<>
							<ApprovalFormField id="plugin-package" label={t("manageApproval.fields.packageName")}>
								<Input id="plugin-package" value={npmDistribution.packageName} readOnly />
							</ApprovalFormField>
							<ApprovalFormField id="plugin-package-spec" label={t("manageApproval.fields.packageSpec")}>
								<Input id="plugin-package-spec" value={npmDistribution.requestedSpec} readOnly />
							</ApprovalFormField>
						</>
					) : (
						<ApprovalFormField id="plugin-path" label={t("manageApproval.fields.path")}>
							<Input id="plugin-path" value={path} onChange={(e) => setPath(e.target.value)} />
						</ApprovalFormField>
					)}
					<ApprovalImpactCard
						icon="icon-[mdi--shield-key-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t(`manageApproval.plugins.ops.${operationKey}.impact`)}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
