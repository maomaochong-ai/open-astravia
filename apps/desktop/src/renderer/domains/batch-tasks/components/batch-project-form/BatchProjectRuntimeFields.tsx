import { ModelSelect } from "@shared/components/ModelSelect";
import { Input } from "@shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import type { ExecutionModeOverride, SessionExecutionMode } from "@shared/store/atoms";
import { BatchProjectRuntimeFieldsView } from "@vetta/theme-ui/batch-tasks";
import { useBatchProjectRuntimeFieldsModel } from "../../hooks/useBatchProjectRuntimeFieldsModel";
import { normalizeTimeout } from "../../utils/batchProjectFormData";

export function BatchProjectRuntimeFields({
	concurrency,
	defaultExecutionMode,
	executionMode,
	modelKey,
	sandboxUnavailableReason,
	timeoutMinutes,
	onConcurrencyChange,
	onExecutionModeChange,
	onModelKeyChange,
	onTimeoutChange,
}: {
	concurrency: number | undefined;
	defaultExecutionMode: SessionExecutionMode;
	executionMode: ExecutionModeOverride | undefined;
	modelKey: string | undefined;
	sandboxUnavailableReason: string | null;
	timeoutMinutes: number | undefined;
	onConcurrencyChange: (value: number) => void;
	onExecutionModeChange: (value: ExecutionModeOverride) => void;
	onModelKeyChange: (value: string | undefined) => void;
	onTimeoutChange: (value: number) => void;
}): JSX.Element {
	const model = useBatchProjectRuntimeFieldsModel({
		concurrency,
		defaultExecutionMode,
		executionMode,
		timeoutMinutes,
	});

	return (
		<BatchProjectRuntimeFieldsView
			labels={model.labels}
			modelSelect={
				<ModelSelect
					value={modelKey ?? null}
					onChange={(key) => onModelKeyChange(key ?? undefined)}
					placeholder={model.modelSelectPlaceholder}
					triggerClassName="w-full rounded-md border-border px-3 py-2 text-sm"
				/>
			}
			concurrencySelect={
				<Select
					value={String(model.concurrency)}
					onValueChange={(nextValue) => onConcurrencyChange(Number(nextValue))}
				>
					<SelectTrigger className="w-24">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="1">1</SelectItem>
						<SelectItem value="2">2</SelectItem>
						<SelectItem value="3">3</SelectItem>
						<SelectItem value="4">4</SelectItem>
						<SelectItem value="5">5</SelectItem>
					</SelectContent>
				</Select>
			}
			timeoutInput={
				<Input
					type="number"
					min={1}
					step={1}
					value={String(model.timeoutMinutes)}
					onChange={(event) => onTimeoutChange(normalizeTimeout(Number(event.target.value)))}
					className="h-9 w-28"
				/>
			}
			executionModeSelect={
				<Select
					value={model.executionModeValue}
					onValueChange={(nextValue) => onExecutionModeChange(nextValue as ExecutionModeOverride)}
				>
					<SelectTrigger className="w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="inherit">{model.sandboxInheritLabel}</SelectItem>
						<SelectItem value="full-access">{model.fullAccessLabel}</SelectItem>
						<SelectItem
							value="sandbox"
							disabled={Boolean(sandboxUnavailableReason)}
							title={sandboxUnavailableReason ?? undefined}
						>
							{model.useSandboxLabel}
						</SelectItem>
					</SelectContent>
				</Select>
			}
		/>
	);
}
