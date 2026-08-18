import type { WebhookEndpointPublic } from "@preload/api.js";
import { useEffect, useMemo, useState } from "react";
import { useActionApproval } from "../../useActionApproval";
import type { ManageActionApprovalFrameViewProps } from "../ManageActionApprovalFrameView";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface InputData {
	operation: "delete";
	id: string;
}

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "delete" || typeof r.id !== "string") return null;
	return { operation: "delete", id: r.id };
}

export interface WebhookDeleteApprovalModel {
	readonly frame: Omit<ManageActionApprovalFrameViewProps, "children">;
	readonly input: InputData | null;
	readonly rawInput: unknown;
	readonly target: { readonly title: string; readonly subtitle: string };
	readonly impactTitle: string;
	readonly impactDescription: string;
	readonly warning: string;
}

export function useWebhookDeleteApprovalModel(): WebhookDeleteApprovalModel | null {
	const approval = useActionApproval("webhook.delete");
	const { t, frameLabels } = useManageApprovalFrame();
	const input = parseInput(approval?.request.input);
	const [endpoint, setEndpoint] = useState<WebhookEndpointPublic | null>(null);

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

	return useMemo(() => {
		if (!approval) return null;
		const { request, responding, error, approve, reject } = approval;
		return {
			frame: {
				presentation: "dialog" as const,
				title: t("manageApproval.webhook.ops.delete.title"),
				summary: t("manageApproval.webhook.ops.delete.summary"),
				icon: "icon-[mdi--delete-outline]",
				badge: t("manageApproval.webhook.ops.delete.badge"),
				destructive: true,
				labels: frameLabels(request.permission, t("manageApproval.webhook.ops.delete.confirm")),
				responding,
				countdown: approval.countdown.formatted,
				error,
				onReject: reject,
				onApprove: () => approve(),
				canApprove: Boolean(input),
			},
			input,
			rawInput: request.input,
			target: {
				title: endpoint?.name ?? input?.id ?? "",
				subtitle: endpoint?.urlMask ?? input?.id ?? "",
			},
			impactTitle: t("manageApproval.afterActionTitle"),
			impactDescription: t("manageApproval.webhook.ops.delete.impact"),
			warning: t("manageApproval.webhook.ops.delete.warning"),
		};
	}, [approval, endpoint, frameLabels, input, t]);
}
