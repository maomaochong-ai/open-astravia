import { ContextRing } from "../ContextRing";
import { ExecutionModeSelector } from "../ExecutionModeSelector";
import { ModelSelector } from "../ModelSelector";
import { SendButton } from "../SendButton";
import type { ReactNode } from "react";
import { ActiveActionCapsules, type ActiveActionCapsule } from "./ActiveActionCapsules";
import { InputBarToolbarButton } from "./InputBarToolbarButton";
import type { SpeechInputModel } from "./types";
import type { ContextRingModel } from "../../hooks/useContextRingModel";
import type { ExecutionModeSelectorViewProps } from "../execution-mode-selector/types";
import type { ModelSelectorScope } from "../../hooks/useModelSelectorModel";

/** hover / press 缩放走 CSS，与 InputBarToolbarButton 保持一致。 */
const QUEUE_BUTTON_INTERACTION =
	"transition-transform duration-150 ease-out will-change-transform hover:scale-[1.06] active:scale-[0.92]";

export interface InputBarSkillsActionProps {
	readonly active: boolean;
	readonly disabled: boolean;
	readonly title: string;
	readonly onSelect: () => void;
}

export function InputBarSkillsAction({
	active,
	disabled,
	title,
	onSelect,
}: InputBarSkillsActionProps): JSX.Element {
	return (
		<span data-command-panel-toggle="true" className="flex shrink-0">
			<InputBarToolbarButton
				icon="icon-[solar--code-scan-bold-duotone]"
				title={title}
				disabled={disabled}
				onClick={onSelect}
				active={active}
			/>
		</span>
	);
}

export function InputBarToolbarDivider(): JSX.Element {
	return <div className="ml-1 h-4 w-px shrink-0 bg-border/70" />;
}

export interface InputBarAttachmentActionsProps {
	readonly disabled: boolean;
	readonly visible: boolean;
	readonly addImageTitle: string;
	readonly attachFileTitle: string;
	readonly onSelectFiles: () => void;
	readonly onSelectImages: () => void;
}

export function InputBarAttachmentActions({
	disabled,
	visible,
	addImageTitle,
	attachFileTitle,
	onSelectFiles,
	onSelectImages,
}: InputBarAttachmentActionsProps): JSX.Element {
	return (
		<span
			data-command-panel-keep-open="true"
			className={visible ? "flex shrink-0 items-center gap-0.5" : "hidden"}
		>
			<InputBarToolbarButton
				icon="icon-[solar--gallery-linear]"
				title={addImageTitle}
				disabled={disabled}
				onClick={onSelectImages}
			/>
			<InputBarToolbarButton
				icon="icon-[solar--paperclip-linear]"
				title={attachFileTitle}
				disabled={disabled}
				onClick={onSelectFiles}
			/>
		</span>
	);
}

export function InputBarExecutionModeAction({ visible, model }: { readonly visible: boolean; readonly model: ExecutionModeSelectorViewProps }): JSX.Element {
	return (
		<div className={visible ? "min-w-0 shrink" : "hidden"}>
			<ExecutionModeSelector model={model} />
		</div>
	);
}

export interface InputBarActiveActionsProps {
	readonly items: readonly ActiveActionCapsule[];
	readonly removeHint: string;
	readonly groupLabel: (count: number) => string;
}

export function InputBarActiveActions({
	items,
	removeHint,
	groupLabel,
}: InputBarActiveActionsProps): JSX.Element {
	return <ActiveActionCapsules items={items} removeHint={removeHint} groupLabel={groupLabel} />;
}

export function InputBarModelAction({ visible, updateActiveSession = true, scope }: { readonly visible: boolean; readonly updateActiveSession?: boolean; readonly scope?: ModelSelectorScope }): JSX.Element {
	return (
		<div className={visible ? "min-w-0 shrink" : "hidden"}>
			<ModelSelector updateActiveSession={updateActiveSession} scope={scope} />
		</div>
	);
}

export function InputBarContextAction({
	visible,
	model,
	render,
}: {
	readonly visible: boolean;
	readonly model: ContextRingModel;
	readonly render?: (model: ContextRingModel) => ReactNode;
}): JSX.Element {
	return (
		<div className={visible ? "contents" : "hidden"}>
			{render ? render(model) : <ContextRing className="mr-1 shrink-0" model={model} />}
		</div>
	);
}

export interface InputBarSpeechActionProps {
	readonly input: SpeechInputModel | null;
}

export function InputBarSpeechAction({ input }: InputBarSpeechActionProps): JSX.Element | null {
	if (!input?.visible) return null;
	return (
		<InputBarToolbarButton
			icon={input.active ? "icon-[solar--stop-circle-linear]" : "icon-[solar--microphone-3-linear]"}
			title={input.title}
			disabled={input.disabled}
			onClick={input.onToggle}
			active={input.active}
		/>
	);
}

export interface InputBarSendActionProps {
	readonly canSend: boolean;
	readonly canQueue?: boolean;
	readonly isEmpty: boolean;
	readonly isStreaming: boolean;
	readonly queueTitle: string;
	readonly pending?: { readonly label: string };
	readonly onAbort: () => void | Promise<void>;
	readonly onSend: () => void;
}

export function InputBarSendAction({
	canSend,
	canQueue = true,
	isEmpty,
	isStreaming,
	queueTitle,
	pending,
	onAbort,
	onSend,
}: InputBarSendActionProps): JSX.Element {
	return canQueue && isStreaming && !isEmpty && !pending ? (
		<button
			type="button"
			onClick={onSend}
			title={queueTitle}
			className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ${QUEUE_BUTTON_INTERACTION}`}
		>
			<span className="icon-[solar--add-square-linear] h-[18px] w-[18px]" />
		</button>
	) : (
		<div className="shrink-0">
			<SendButton
				canSend={canSend}
				isStreaming={isStreaming}
				pending={pending}
				onSend={onSend}
				onAbort={onAbort}
			/>
		</div>
	);
}
