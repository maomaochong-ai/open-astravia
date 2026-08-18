import { ModelSelect } from "@shared/components/ModelSelect";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import { useMemo, useState } from "react";
import { Switch } from "@vetta/ui";
import { type ActiveActionApproval, useActionApproval } from "../../useActionApproval";
import { knowledgeBaseFieldLabel } from "../../approvalCopy";
import {
	ApprovalImpactCard,
	ApprovalSettingGroup,
	ApprovalSettingRow,
} from "@vetta/theme-ui/action-approval";
import { ApprovalRawFallback } from "../ApprovalParts";
import { useManageApprovalFrame } from "../useManageApprovalShell";

type KbData = {
	enabled?: boolean;
	pollIntervalMinutes?: 3 | 5 | 10 | 30;
	processingModelKey?: string | null;
	processingModelReasoningLevel?: string | null;
	agentConcurrency?: number;
	ocrConcurrency?: number;
};

interface InputData {
	operation: "set-processing";
	data: KbData;
	approvalUi?: string;
}

const POLL_OPTIONS = [3, 5, 10, 30] as const;
const AGENT_CONCURRENCY = [1, 2, 3, 4, 6, 8] as const;
const OCR_CONCURRENCY = [1, 2, 3, 4] as const;

function parseInput(input: unknown): InputData | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const r = input as Record<string, unknown>;
	if (r.operation !== "set-processing" || typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) {
		return null;
	}
	return {
		operation: "set-processing",
		data: r.data as KbData,
		approvalUi: typeof r.approvalUi === "string" ? r.approvalUi : undefined,
	};
}

export function KnowledgeSetProcessingApproval(): JSX.Element | null {
	const approval = useActionApproval("knowledge.set-processing");
	if (!approval) return null;
	return <Content key={approval.request.approvalId} approval={approval} />;
}

function Content({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { Frame, t, frameLabels } = useManageApprovalFrame();
	const { request, responding, error, approve, reject } = approval;
	const input = parseInput(request.input);
	const initial = useMemo(() => input?.data ?? {}, [input]);
	const [data, setData] = useState<KbData>(initial);

	const onApprove = (): void => {
		if (!input) {
			approve();
			return;
		}
		const next: KbData = {};
		if (data.enabled !== undefined) next.enabled = data.enabled;
		if (data.pollIntervalMinutes !== undefined) next.pollIntervalMinutes = data.pollIntervalMinutes;
		if (data.processingModelKey !== undefined) {
			next.processingModelKey = data.processingModelKey;
		}
		if (data.processingModelReasoningLevel !== undefined) {
			next.processingModelReasoningLevel = data.processingModelReasoningLevel;
		}
		if (data.agentConcurrency !== undefined) next.agentConcurrency = data.agentConcurrency;
		if (data.ocrConcurrency !== undefined) next.ocrConcurrency = data.ocrConcurrency;
		approve({
			operation: "set-processing",
			data: next,
			approvalUi: input.approvalUi ?? "knowledge.set-processing",
		});
	};

	const rows: Array<{ key: string; node: JSX.Element }> = [];
	if (data.enabled !== undefined) {
		rows.push({
			key: "enabled",
			node: (
				<ApprovalSettingRow
					title={knowledgeBaseFieldLabel(t, "enabled")}
					description={t("manageApproval.knowledge.processingFields.enabledDesc")}
					border
				>
					<div className="flex items-center gap-2">
						<span
							className={
								data.enabled
									? "text-[11px] font-medium text-primary"
									: "text-[11px] font-medium text-muted-foreground"
							}
						>
							{data.enabled ? t("manageApproval.on") : t("manageApproval.off")}
						</span>
						<Switch
							checked={data.enabled}
							onCheckedChange={(checked) => setData((prev) => ({ ...prev, enabled: checked }))}
						/>
					</div>
				</ApprovalSettingRow>
			),
		});
	}
	if (data.pollIntervalMinutes !== undefined) {
		rows.push({
			key: "poll",
			node: (
				<ApprovalSettingRow
					title={knowledgeBaseFieldLabel(t, "pollIntervalMinutes")}
					description={t("manageApproval.knowledge.processingFields.pollIntervalDesc")}
					border
				>
					<Select
						value={String(data.pollIntervalMinutes)}
						onValueChange={(value) =>
							setData((prev) => ({
								...prev,
								pollIntervalMinutes: Number(value) as 3 | 5 | 10 | 30,
							}))
						}
					>
						<SelectTrigger className="h-8 min-w-[140px] px-2 text-[12px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{POLL_OPTIONS.map((minutes) => (
								<SelectItem key={minutes} value={String(minutes)} className="text-[12px]">
									{t("manageApproval.knowledge.processingFields.pollMinutes", { count: minutes })}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</ApprovalSettingRow>
			),
		});
	}
	if (data.processingModelKey !== undefined) {
		rows.push({
			key: "model",
			node: (
				<ApprovalSettingRow
					title={knowledgeBaseFieldLabel(t, "processingModelKey")}
					description={t("manageApproval.knowledge.processingFields.processingModelDesc")}
					border
				>
					<ModelSelect
						value={data.processingModelKey}
						onChange={(key) =>
							setData((prev) => ({
								...prev,
								processingModelKey: key,
								// 换模型时清空推理档，避免非法组合
								processingModelReasoningLevel:
									prev.processingModelReasoningLevel === undefined
										? undefined
										: null,
							}))
						}
						allowClear
						placeholder={t("modelSelect.placeholder")}
						triggerClassName="min-w-[200px]"
						reasoning={
							data.processingModelReasoningLevel !== undefined
								? {
										value: data.processingModelReasoningLevel ?? undefined,
										onChange: (level) =>
											setData((prev) => ({
												...prev,
												processingModelReasoningLevel: level,
											})),
									}
								: undefined
						}
					/>
				</ApprovalSettingRow>
			),
		});
	}
	if (data.agentConcurrency !== undefined) {
		rows.push({
			key: "agentConcurrency",
			node: (
				<ApprovalSettingRow
					title={knowledgeBaseFieldLabel(t, "agentConcurrency")}
					description={t("manageApproval.knowledge.processingFields.agentConcurrencyDesc")}
					border
				>
					<Select
						value={String(data.agentConcurrency)}
						onValueChange={(value) =>
							setData((prev) => ({
								...prev,
								agentConcurrency: Number(value),
							}))
						}
					>
						<SelectTrigger className="h-8 min-w-[100px] px-2 text-[12px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AGENT_CONCURRENCY.map((count) => (
								<SelectItem key={count} value={String(count)} className="text-[12px]">
									{count}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</ApprovalSettingRow>
			),
		});
	}
	if (data.ocrConcurrency !== undefined) {
		rows.push({
			key: "ocrConcurrency",
			node: (
				<ApprovalSettingRow
					title={knowledgeBaseFieldLabel(t, "ocrConcurrency")}
					description={t("manageApproval.knowledge.processingFields.ocrConcurrencyDesc")}
					border
				>
					<Select
						value={String(data.ocrConcurrency)}
						onValueChange={(value) =>
							setData((prev) => ({
								...prev,
								ocrConcurrency: Number(value),
							}))
						}
					>
						<SelectTrigger className="h-8 min-w-[100px] px-2 text-[12px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{OCR_CONCURRENCY.map((count) => (
								<SelectItem key={count} value={String(count)} className="text-[12px]">
									{count}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</ApprovalSettingRow>
			),
		});
	}

	// 最后一行去掉底边框
	const renderedRows = rows.map((row, index) => {
		if (index === rows.length - 1) {
			return (
				<div key={row.key} className="[&>div]:border-b-0">
					{row.node}
				</div>
			);
		}
		return <div key={row.key}>{row.node}</div>;
	});

	return (
		<Frame
			presentation="drawer"
			title={t("manageApproval.knowledge.ops.set-processing.title")}
			summary={t("manageApproval.knowledge.ops.set-processing.summary")}
			icon="icon-[mdi--bookshelf]"
			badge={t("manageApproval.knowledge.ops.set-processing.badge")}
			labels={frameLabels(request.permission, t("manageApproval.knowledge.ops.set-processing.confirm"))}
			responding={responding}
			countdown={approval.countdown.formatted}
			error={error}
			onReject={reject}
			onApprove={onApprove}
			canApprove={Boolean(input) && Object.keys(data).length > 0}
		>
			{input ? (
				<>
					<ApprovalSettingGroup
						title={t("manageApproval.knowledge.processingSectionTitle")}
						description={t("manageApproval.knowledge.processingSectionDescription")}
					>
						{renderedRows}
					</ApprovalSettingGroup>
					<ApprovalImpactCard
						icon="icon-[mdi--bookshelf]"
						title={t("manageApproval.afterActionTitle")}
						description={t("manageApproval.knowledge.ops.set-processing.impact")}
					/>
				</>
			) : (
				<ApprovalRawFallback input={request.input} />
			)}
		</Frame>
	);
}
