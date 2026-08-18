import type { WebhookEndpointPublic } from "@preload/api.js";
import { useEffect, useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { getToggleApprovalCopy, getToggleSharedLabels } from "../../approvalToggleCopy";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalToggleIntentCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "set-enabled";
	id: string;
	enabled: boolean;
	approvalUi?: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-enabled" || typeof r.id !== "string" || typeof r.enabled !== "boolean") {
		return null;
	}
	return {
		operation: "set-enabled",
		id: r.id,
		enabled: r.enabled,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}


/** Model marker for inventory thin/container-with-view classification. */
function useWebhookSetEnabledApprovalModel(approval: ActiveActionApproval): ActiveActionApproval {
	return approval;
}

export function WebhookSetEnabledApproval(): JSX.Element | null {
	const approval = useActionApproval("webhook.set-enabled");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { ManageActionApprovalFrame, t, frameLabels } = useManageApprovalFrame();
	const _approvalModel = useWebhookSetEnabledApprovalModel(approval);
	void _approvalModel;
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [enabled, setEnabled] = useState(input?.enabled ?? true);
	const [endpoint, setEndpoint] = useState<WebhookEndpointPublic | null>(null);
	const copy = getToggleApprovalCopy(t, "webhook", enabled);
	const shared = getToggleSharedLabels(t);

	useEffect(() => {
		if (!input?.id) return;
		let cancelled = false;
		void window.vetta.webhook
			.list()
			.then((items) => {
				if (!cancelled) setEndpoint(items.find((item) => item.id === input.id) ?? null);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [input?.id]);

	return (
		<ManageActionApprovalFrame
			presentation="dialog"
			title={copy.title}
			summary={copy.summary}
			icon={copy.icon}
			badge={copy.badge}
			labels={frameLabels(request.permission, copy.confirm)}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() =>
				input
					? approve({
							operation: "set-enabled",
							id: input.id,
							enabled,
							approvalUi: input.approvalUi ?? "webhook.set-enabled",
						})
					: approve()
			}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalToggleIntentCard
						targetIcon="icon-[mdi--webhook]"
						targetTitle={endpoint?.name ?? input.id}
						targetSubtitle={endpoint?.urlMask ?? t("manageApproval.fields.id")}
						enabled={enabled}
						onEnabledChange={setEnabled}
						willBecomeLabel={shared.willBecome}
						stateOnLabel={shared.stateOn}
						stateOffLabel={shared.stateOff}
						stateHint={enabled ? shared.stateOnHint : shared.stateOffHint}
						editableHint={shared.editableHint}
					/>
					<ApprovalImpactCard
						icon={copy.icon}
						title={t("manageApproval.afterActionTitle")}
						description={copy.impact}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</ManageActionApprovalFrame>
	);
}
