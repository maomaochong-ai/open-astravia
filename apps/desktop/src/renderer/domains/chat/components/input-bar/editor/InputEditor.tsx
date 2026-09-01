import { ConversationEditorView } from "@shared/components/conversation-editor/ConversationEditorView";
import { memo, type MouseEvent } from "react";
import { INPUT_EDITOR_NODES } from "./nodes";
import { EditorHandlePlugin } from "./plugins/EditorHandlePlugin";
import { HistoryNavPlugin } from "./plugins/HistoryNavPlugin";
import { PasteImagePlugin } from "./plugins/PasteImagePlugin";
import { TriggerPlugin } from "./plugins/TriggerPlugin";
import { ValueBridgePlugin } from "./plugins/ValueBridgePlugin";
import type { TriggerMatch } from "./tokens/trigger";

export interface InputEditorProps {
	ariaLabel: string;
	editable: boolean;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onEnter: () => boolean;
	onFocusChange: (focused: boolean) => void;
	onTriggerChange: (trigger: TriggerMatch | null) => void;
}

/**
 * 多模态输入区：文本与 skill / 文件 / 图片 token 同处一条文本流。
 *
 * 用 PlainTextPlugin 而非 RichText——需要的只有「单段文本 + 软换行 + 行内原子节点」，
 * 富文本格式化命令一概不要，粘贴也由它按纯文本处理（多行转 LineBreak，不生成新段落）。
 * contenteditable 随内容自然增高，因此旧 textarea 那套 scrollHeight 手动测量
 * 与「先归零再读高」的防抖 hack 一并去掉了。
 */
export const InputEditor = memo(function InputEditor({
	ariaLabel,
	editable,
	onContextMenu,
	onEnter,
	onFocusChange,
	onTriggerChange,
}: InputEditorProps): JSX.Element {
	return (
		<ConversationEditorView
			namespace="chat-input"
			ariaLabel={ariaLabel}
			editable={editable}
			nodes={INPUT_EDITOR_NODES}
			onContextMenu={onContextMenu}
			onEnter={onEnter}
			onFocusChange={onFocusChange}
			plugins={
				<>
					<EditorHandlePlugin />
					<ValueBridgePlugin />
					<HistoryNavPlugin />
					<TriggerPlugin onTriggerChange={onTriggerChange} />
					<PasteImagePlugin />
				</>
			}
		/>
	);
});
