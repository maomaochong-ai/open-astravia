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

interface InputData {
	operation: "set-agent-model";
	modelKey: string | null;
	reasoningLevel?: string;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-agent-model") return null;
	if (r.modelKey !== null && r.modelKey !== undefined && typeof r.modelKey !== "string") return null;
	return {
		operation: "set-agent-model",
		modelKey: typeof r.modelKey === "string" ? r.modelKey : null,
		reasoningLevel: typeof r.reasoningLevel === "string" ? r.reasoningLevel : undefined,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function ImSetAgentModelApproval(): JSX.Element | null {
	const approval = useActionApproval("im.set-agent-model");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [modelKey, setModelKey] = useState<string | null>(input?.modelKey ?? null);
	const [reasoningLevel, setReasoningLevel] = useState<string | undefined>(input?.reasoningLevel);

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.im.ops.set-agent-model.title")}
			summary={t("manageApproval.im.ops.set-agent-model.summary")}
			icon="icon-[mdi--robot-outline]"
			badge={t("manageApproval.im.ops.set-agent-model.badge")}
			labels={frameLabels(request.permission, t("manageApproval.im.ops.set-agent-model.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => {
				if (!input) {
					approve();
					return;
				}
				approve({
					operation: "set-agent-model",
					modelKey,
					...(reasoningLevel ? { reasoningLevel } : {}),
					approvalUi: input.approvalUi ?? "im.set-agent-model",
				});
			}}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.im.modelSectionTitle")}
						description={t("manageApproval.im.modelSectionDescription")}
					>
						<ApprovalSettingRow
							title={t("manageApproval.fields.modelKey")}
							description={t("manageApproval.im.modelKeyHint")}
							border={false}
						>
							<ModelSelect
								value={modelKey}
								onChange={(key) => {
									setModelKey(key);
									// 换模型后推理档位由新模型默认接管，避免残留非法档位
									setReasoningLevel(undefined);
								}}
								allowClear
								placeholder={t("manageApproval.im.modelKeyPlaceholder")}
								triggerClassName="min-w-[220px]"
								reasoning={{
									value: reasoningLevel,
									onChange: setReasoningLevel,
								}}
							/>
						</ApprovalSettingRow>
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon="icon-[mdi--robot-outline]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.im.ops.set-agent-model.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
