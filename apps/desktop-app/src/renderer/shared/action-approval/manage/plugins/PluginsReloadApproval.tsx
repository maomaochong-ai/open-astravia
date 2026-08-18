import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input { operation: "reload"; id: string; }

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "reload" || typeof r.id !== "string") return null;
	return { operation: "reload", id: r.id };
}

export function PluginsReloadApproval(): JSX.Element | null {
	const approval = useActionApproval("plugins.reload");
	if (!approval) return null;
	return <PluginsReloadApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function PluginsReloadApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const icon = "icon-[mdi--reload]";

	return (
		<Frame
			presentation="dialog"
			title={t("manageApproval.plugins.ops.reload.title")}
			summary={t("manageApproval.plugins.ops.reload.summary")}
			icon={icon}
			badge={t("manageApproval.plugins.ops.reload.badge")}
			labels={frameLabels(request.permission, t("manageApproval.plugins.ops.reload.confirm"))}
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
						description={t("manageApproval.plugins.ops.reload.impact")}
						
					/>
					
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
