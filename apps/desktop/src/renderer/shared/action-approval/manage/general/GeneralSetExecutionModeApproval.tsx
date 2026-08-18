import { useState } from "react";
import {
	GeneralSetExecutionModeApprovalView,
	type ExecutionModeOption,
} from "@vetta/theme-ui/action-approval";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { formatExecutionMode } from "../../approvalCopy";
import { useManageApprovalFrame } from "../useManageApprovalShell";

type ExecutionMode = ExecutionModeOption;

interface Input {
	operation: "set-execution-mode";
	mode: ExecutionMode;
	approvalUi?: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-execution-mode") return null;
	if (r.mode !== "sandbox" && r.mode !== "full-access") return null;
	return r as unknown as Input;
}

const MODES: ExecutionMode[] = ["sandbox", "full-access"];

export function GeneralSetExecutionModeApproval(): JSX.Element | null {
	const approval = useActionApproval("general.set-execution-mode");
	if (!approval) return null;
	return <GeneralSetExecutionModeApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function GeneralSetExecutionModeApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [mode, setMode] = useState<ExecutionMode>(input?.mode ?? "sandbox");
	const icon = "icon-[mdi--shield-lock-outline]";

	return (
		<GeneralSetExecutionModeApprovalView
			Frame={Frame}
			frame={{
				presentation: "drawer",
				title: t("manageApproval.general.ops.set-execution-mode.title"),
				summary: t("manageApproval.general.ops.set-execution-mode.summary"),
				icon,
				badge: t("manageApproval.general.ops.set-execution-mode.badge"),
				labels: frameLabels(request.permission, t("manageApproval.general.ops.set-execution-mode.confirm")),
				responding,
				countdown: approval.countdown.formatted,
				error,
				onReject: reject,
				onApprove: () =>
					input
						? approve({
								operation: "set-execution-mode",
								mode,
								approvalUi: input.approvalUi ?? "general.set-execution-mode",
							})
						: approve(),
				canApprove: Boolean(input),
			}}
			hasInput={Boolean(input)}
			rawInput={request.input}
			rawFallbackLabels={{
				unreadableRequest: t("actionApproval.unreadableRequest"),
				showTechnicalDetails: t("actionApproval.showTechnicalDetails"),
				hideTechnicalDetails: t("actionApproval.hideTechnicalDetails"),
			}}
			mode={mode}
			modes={MODES}
			modeLabel={(candidate) => formatExecutionMode(t, candidate)}
			modeHint={(candidate) =>
				candidate === "sandbox"
					? t("manageApproval.general.executionModeSandboxHint")
					: t("manageApproval.general.executionModeFullAccessHint")
			}
			executionModeFieldLabel={t("manageApproval.fields.executionMode")}
			impactTitle={t("manageApproval.afterActionTitle")}
			impactDescription={t("manageApproval.general.ops.set-execution-mode.impact")}
			icon={icon}
			onModeChange={setMode}
		/>
	);
}
