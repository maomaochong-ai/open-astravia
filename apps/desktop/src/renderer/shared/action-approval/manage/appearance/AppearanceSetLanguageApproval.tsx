import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { type: "set-language"; language: "zh" | "en"; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.type !== "set-language") return null;
	return r as unknown as Input;
}

export function AppearanceSetLanguageApproval(): JSX.Element | null {
	const approval = useActionApproval("appearance.set-language");
	if (!approval) return null;
	return <AppearanceSetLanguageApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function AppearanceSetLanguageApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--translate]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.appearance.ops.set-language.title")}
			summary={t("manageApproval.appearance.ops.set-language.summary")}
			icon={icon}
			badge={t("manageApproval.appearance.ops.set-language.badge")}
			labels={frameLabels(request.permission, t("manageApproval.appearance.ops.set-language.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--translate]" title={input.language === "zh" ? t("manageApproval.appearance.languageZh") : t("manageApproval.appearance.languageEn")} subtitle={input.language} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.appearance.ops.set-language.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
