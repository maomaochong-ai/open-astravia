import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "uninstall"; id: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "uninstall" || typeof r.id !== "string") return null;
	return { operation: "uninstall", id: r.id };
}

export function PluginsUninstallApproval(): JSX.Element | null {
	const approval = useActionApproval("plugins.uninstall");
	if (!approval) return null;
	return <PluginsUninstallApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function PluginsUninstallApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--delete-outline]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.plugins.ops.uninstall.title")}
			summary={t("manageApproval.plugins.ops.uninstall.summary")}
			icon={icon}
			badge={t("manageApproval.plugins.ops.uninstall.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.plugins.ops.uninstall.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard icon="icon-[mdi--puzzle-outline]" title={input.id} subtitle={t("manageApproval.fields.pluginId")} />
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.plugins.ops.uninstall.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.plugins.ops.uninstall.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
