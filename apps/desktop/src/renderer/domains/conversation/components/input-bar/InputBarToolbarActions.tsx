import { MessageInput } from "@astravia-org/theme-ui/chat/MessageInputView";
import type { ReactNode } from "react";
import { InputBarMention } from "./InputBarMention";
import {
	InputBarActiveActions,
	InputBarAttachmentActions,
	InputBarExecutionModeAction,
	InputBarContextAction,
	InputBarSendAction,
	InputBarSkillsAction,
	InputBarSpeechAction,
	InputBarToolbarDivider,
} from "./InputBarToolbar";
import { TOOLBAR_SCROLL_CLASS, handleHorizontalWheel } from "@shared/lib/horizontal-wheel-scroll";
import { useModelMenuFooter } from "./model-menu-footer-context";
import type { InputBarModel } from "./types";

export function InputBarLeadingActions({ model }: { readonly model: InputBarModel }): JSX.Element {
	const commands = model.commands;
	const slashOpen = commands?.slashOpen ?? false;
	const menuFooter = useModelMenuFooter();
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
					title={model.labels.toolbar.add}
					onSelect={commands.onOpen}
				/>
			) : null}
			{model.routing ? (
				<InputBarMention model={model.routing} disabled={!model.hasSession} visible={!slashOpen} />
			) : null}
			{/*
			 * 分割线只在**下一组控件真的渲染**时才画：面板收起时附件按钮整组隐藏，
			 * 这条线会变成加号右边一根悬空的竖线（默认态只剩「添加」一个按钮时尤其明显）。
			 */}
			{commands?.slashOpen ? <InputBarToolbarDivider /> : null}
			{/* 两组控件保持挂载、只切 display，避免展开动画首帧重建复杂 selector。 */}
			<InputBarAttachmentActions
				disabled={!model.hasSession}
				visible={!commands || commands.slashOpen}
				addImageTitle={model.labels.toolbar.addImage}
				attachFileTitle={model.labels.toolbar.attachFile}
				onSelectFiles={() => void model.actions.handleSelectFiles()}
				onSelectImages={() => void model.actions.handleSelectImages()}
			/>
			{/*
			 * 权限模式（沙箱 / 完全访问）默认排在工具栏里；当宿主提供了模型菜单底栏插槽时
			 * （三栏菜单有底栏），它改为渲染在菜单里——低频入口，与「用哪个模型」同属
			 * 一次「这次怎么跑」的决策。团队对话用的是行内选择器，没有底栏，仍留在工具栏。
			 *
			 * 必须写成 JSX 注释（花括号包住）。裸的块注释在 JSX children 位置是普通文本，
			 * 会被当字面量渲染进工具栏：一条两百字的段落把工具行撑到 100–300px 高、
			 * 压住模型选择器与发送按钮，看起来像草稿泄漏进了工具栏。
			 */}
			{menuFooter
				? null
				: model.leadingTools.map((tool) => (
						<InputBarExecutionModeAction key={tool.kind} visible={!slashOpen} model={tool.model} />
					))}
			{/*
			 * 激活胶囊（技能、上下文、子代理…）自成一组：它前面保留一条竖线，
			 * 否则胶囊紧贴执行模式控件，看起来像同一组的另一颗按钮。
			 *
			 * 执行模式已移进模型菜单时这里没有左侧兄弟，竖线会挂在行首变成一根悬空短线，
			 * 因此只有工具栏里确实渲染了前一组控件时才画。
			 */}
			{!menuFooter && model.activeActions.length > 0 && !slashOpen ? <InputBarToolbarDivider /> : null}
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
			{/*
			 * 工具一多就会被裁掉，鼠标又没有横向滚轮：把纵向滚轮映射成横向滚动，
			 * 溢出时拦截、不溢出时让页面照常滚。scrollbar 隐藏但容器仍可聚焦滚动。
			 */}
			<MessageInput.ToolbarLeading className={TOOLBAR_SCROLL_CLASS} onWheel={handleHorizontalWheel}>
				<InputBarLeadingActions model={model} />
			</MessageInput.ToolbarLeading>
			<MessageInput.ToolbarTrailing>
				{/*
				 * `flex` 而不是块级：被挤压时让里面的触发器真的收缩并省略，
				 * 块级包裹层宽 0 也不会裁掉子元素，模型名会照旧溢出到语音/发送按钮上。
				 */}
				<div className={model.commands?.slashOpen ? "hidden" : "flex min-w-0 shrink"}>{children}</div>
				<InputBarTrailingActions model={model} />
			</MessageInput.ToolbarTrailing>
		</>
	);
}
