import { useThemeComponent } from "@vetta/theme-sdk";
import { useTranslation } from "react-i18next";
import { formatApprovalWhyConfirm } from "./approvalCopy";
import { GenericActionApprovalView } from "./GenericActionApprovalView";
import { useActionApproval } from "./useActionApproval";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 input 抽出用户可读字段，跳过实现细节键。 */
function buildDisplayFields(
	input: unknown,
	t: ReturnType<typeof useTranslation<"common">>["t"],
): Array<{ label: string; value: string }> {
	if (!isRecord(input)) {
		if (input === undefined || input === null) return [];
		return [{ label: t("actionApproval.fields.request"), value: String(input) }];
	}

	const skip = new Set(["approvalUi", "type"]);
	const fields: Array<{ label: string; value: string }> = [];

	for (const [key, value] of Object.entries(input)) {
		if (skip.has(key) || value === undefined) continue;
		if (key === "operation" && typeof value === "string") {
			fields.push({ label: t("actionApproval.fields.operation"), value });
			continue;
		}
		if (typeof value === "boolean") {
			fields.push({
				label: key,
				value: value ? t("manageApproval.on") : t("manageApproval.off"),
			});
			continue;
		}
		if (typeof value === "string" || typeof value === "number") {
			fields.push({ label: key, value: String(value) });
			continue;
		}
		if (Array.isArray(value)) {
			fields.push({
				label: key,
				value: t("actionApproval.fields.arrayCount", { count: value.length }),
			});
			continue;
		}
		if (isRecord(value)) {
			const nestedKeys = Object.keys(value);
			fields.push({
				label: key,
				value: t("actionApproval.fields.objectSummary", { count: nestedKeys.length }),
			});
		}
	}

	return fields;
}

export function GenericActionApproval(): JSX.Element | null {
	const { t } = useTranslation("common");
	const approval = useActionApproval("generic");
	const ThemedGenericActionApprovalView = useThemeComponent(
		"root.genericActionApprovalView",
		GenericActionApprovalView,
	);
	if (!approval) return null;
	const { request, responding, error, approve, reject } = approval;
	const fields = buildDisplayFields(request.input, t);

	return (
		<ThemedGenericActionApprovalView
			confirmLabel={t("actionApproval.confirm")}
			countdown={approval.countdown.formatted}
			error={error}
			fields={fields}
			inputJson={JSON.stringify(request.input, null, 2)}
			labels={{
				rejecting: t("actionApproval.reject"),
				responding: t("actionApproval.processing"),
				showTechnicalDetails: t("actionApproval.showTechnicalDetails"),
				hideTechnicalDetails: t("actionApproval.hideTechnicalDetails"),
				impactTitle: t("manageApproval.afterActionTitle"),
				impactDescription: t("actionApproval.genericImpact"),
			}}
			onApprove={() => approve()}
			onReject={reject}
			permissionLabel={formatApprovalWhyConfirm(t, request.permission)}
			responding={responding}
			summary={request.summary || t("actionApproval.genericSummary")}
			title={request.title || t("actionApproval.genericTitle")}
		/>
	);
}
