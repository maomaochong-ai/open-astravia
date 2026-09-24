import { MessageInput } from "@vetta-org/theme-ui/chat";
import type { ReactNode } from "react";
import { InputBarMention } from "./InputBarMention";
import {
	InputBarActiveActions,
	InputBarAttachmentActions,
	InputBarContextAction,
	InputBarExecutionModeAction,
	InputBarSendAction,
	InputBarSkillsAction,
	InputBarSpeechAction,
	InputBarToolbarDivider,
} from "./InputBarToolbar";
import type { InputBarModel } from "./types";

export function InputBarLeadingActions({ model }: { readonly model: InputBarModel }): JSX.Element {
	const commands = model.commands;
	const slashOpen = commands?.slashOpen ?? false;
	return (
		<>
			{/*
			 * 标记给命令区的 click-outside 判定用：否则 mousedown 先收起、
			 * 随后的 click 又打开，按钮无法关闭面板。
			 */}
			{commands ? (
				<InputBarSkillsAction
					active={commands.slashOpen}
					disabled={!model.hasSession}
					title={model.labels.toolbar.skills}
					onSelect={commands.onOpen}
				/>
			) : null}
			{model.routing ? (
				<InputBarMention model={model.routing} disabled={!model.hasSession} visible={!slashOpen} />
			) : null}
			{commands ? <InputBarToolbarDivider /> : null}
			{/* 两组控件保持挂载、只切 display，避免展开动画首帧重建复杂 selector。 */}
			<InputBarAttachmentActions
				disabled={!model.hasSession}
				visible={!commands || commands.slashOpen}
				addImageTitle={model.labels.toolbar.addImage}
				attachFileTitle={model.labels.toolbar.attachFile}
				onSelectFiles={() => void model.actions.handleSelectFiles()}
				onSelectImages={() => void model.actions.handleSelectImages()}
			/>
			{model.leadingTools.map((tool) => (
				<InputBarExecutionModeAction key={tool.kind} visible={!slashOpen} model={tool.model} />
			))}
			<InputBarActiveActions
				items={model.activeActions}
				removeHint={model.labels.capsule.removeDefault}
				groupLabel={model.labels.capsule.activeGroup}
			/>
		</>
	);
}

export function InputBarTrailingActions({ model }: { readonly model: InputBarModel }): JSX.Element {
	const slashOpen = model.commands?.slashOpen ?? false;
	return (
		<>
			{model.trailingTools.map((tool) => (
				<InputBarContextAction key={tool.kind} visible={!slashOpen} model={tool.model} render={tool.render} />
			))}
			{slashOpen ? null : <InputBarSpeechAction input={model.speechInput} />}
			<InputBarSendAction
				canSend={model.canSend}
				canQueue={model.sendBehavior === "queueable"}
				isEmpty={model.isEmpty}
				isStreaming={model.isStreaming}
				queueTitle={model.labels.toolbar.queue}
				pending={model.sendPending}
				onAbort={model.actions.handleAbort}
				onSend={model.actions.handleSend}
			/>
		</>
	);
}

/** Shared toolbar recipe: callers compose the model controls, common actions keep their order. */
export function InputBarToolbar({
	model,
	children,
}: {
	readonly model: InputBarModel;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<>
			<MessageInput.ToolbarLeading>
				<InputBarLeadingActions model={model} />
			</MessageInput.ToolbarLeading>
			<MessageInput.ToolbarTrailing>
				<div className={model.commands?.slashOpen ? "hidden" : "min-w-0 shrink"}>{children}</div>
				<InputBarTrailingActions model={model} />
			</MessageInput.ToolbarTrailing>
		</>
	);
}
