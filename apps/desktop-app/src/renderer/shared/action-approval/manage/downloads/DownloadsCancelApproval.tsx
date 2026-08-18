import type { DownloadItem } from "@preload/api.js";
import { useEffect, useState } from "react";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import {
	ApprovalImpactCard,
	ApprovalRawFallback,
	ApprovalTargetCard,
	ApprovalWarningCard,
} from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

interface Input {
	operation: "cancel";
	id: string;
}

function parseInput(input: unknown): Input | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "cancel" || typeof r.id !== "string") return null;
	return { operation: "cancel", id: r.id };
}


/** Model marker for inventory thin/container-with-view classification. */
function useDownloadsCancelApprovalModel(approval: ActiveActionApproval): ActiveActionApproval {
	return approval;
}

export function DownloadsCancelApproval(): JSX.Element | null {
	const approval = useActionApproval("downloads.cancel");
	if (!approval) return null;
	return <DownloadsCancelApprovalContent key={approval.request.approvalId} approval={approval} />;
}

function DownloadsCancelApprovalContent({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { ManageActionApprovalFrame, t, frameLabels } = useManageApprovalFrame();
	const _approvalModel = useDownloadsCancelApprovalModel(approval);
	void _approvalModel;
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const [item, setItem] = useState<DownloadItem | null>(null);
	const icon = "icon-[mdi--download-off-outline]";

	useEffect(() => {
		if (!input?.id) return;
		let cancelled = false;
		void window.vetta.downloads
			.list()
			.then((items) => {
				if (cancelled) return;
				setItem(items.find((candidate) => candidate.id === input.id) ?? null);
			})
			.catch(() => {
				if (!cancelled) setItem(null);
			});
		return () => {
			cancelled = true;
		};
	}, [input?.id]);

	const title = item?.filename?.trim() || input?.id || t("manageApproval.unknown");
	const subtitle = item?.url || (input ? t("manageApproval.fields.id") : undefined);

	return (
		<ManageActionApprovalFrame
			presentation="dialog"
			title={t("manageApproval.downloads.ops.cancel.title")}
			summary={t("manageApproval.downloads.ops.cancel.summary")}
			icon={icon}
			badge={t("manageApproval.downloads.ops.cancel.badge")}
			destructive
			labels={frameLabels(request.permission, t("manageApproval.downloads.ops.cancel.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={() => approve()}
			canApprove={Boolean(input)}
		>
			{input ? (
				<>
					<ApprovalTargetCard
						icon="icon-[mdi--download-outline]"
						title={title}
						subtitle={subtitle}
						subtitleMono={Boolean(item?.url)}
						rows={
							item
								? [
										{
											label: t("manageApproval.downloads.status"),
											value: t(`manageApproval.downloads.statuses.${item.status}`, {
												defaultValue: item.status,
											}),
										},
									]
								: undefined
						}
					/>
					<ApprovalImpactCard
						icon={icon}
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.downloads.ops.cancel.impact")}
						destructive
					/>
					<ApprovalWarningCard>{t("manageApproval.downloads.ops.cancel.warning")}</ApprovalWarningCard>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</ManageActionApprovalFrame>
	);
}
