import { ModelSelect } from "@shared/components/ModelSelect";
import { useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalSettingGroup,
	ApprovalSettingRow,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input {
	operation: "set-default";
	modelKey: string;
	approvalUi?: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-default" || typeof r.modelKey !== "string" || r.modelKey.trim().length === 0) {
		return null;
	}
	return {
		operation: "set-default",
		modelKey: r.modelKey,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ModelsSetDefaultApproval(): JSX.Element | null {
	const approval = useActionApproval("models.set-default");
	if (!approval) return null;
	return <ModelsSetDefaultApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function ModelsSetDefaultApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [modelKey, setModelKey] = useState<string | null>(input?.modelKey ?? null);
	const icon = "icon-[mdi--star-check-outline]";

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.models.ops.set-default.title")}
			summary={t("manageApproval.models.ops.set-default.summary")}
			icon={icon}
			badge={t("manageApproval.models.ops.set-default.badge")}
			labels={frameLabels(request.permission, t("manageApproval.models.ops.set-default.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input && modelKey
					? approve({
							operation: "set-default",
							modelKey,
							approvalUi: input.approvalUi ?? "models.set-default",
						})
					: approve()
			}
			canApprove={Boolean(input && modelKey)}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.models.defaultSectionTitle")}
						description={t("manageApproval.models.defaultSectionDescription")}
					>
						<ApprovalSettingRow
							title={t("manageApproval.fields.modelKey")}
							description={t("manageApproval.models.defaultModelHint")}
							border={false}
						>
							<ModelSelect
								value={modelKey}
								onChange={setModelKey}
								placeholder={t("modelSelect.placeholder")}
								triggerClassName="min-w-[220px]"
							/>
						</ApprovalSettingRow>
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.models.ops.set-default.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
