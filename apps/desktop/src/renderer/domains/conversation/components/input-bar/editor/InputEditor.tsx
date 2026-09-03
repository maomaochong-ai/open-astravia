import { ConversationEditorView } from "@shared/components/conversation-editor/ConversationEditorView";
import { memo, type MouseEvent } from "react";
import { INPUT_EDITOR_NODES } from "./nodes";
import { ControlledHistoryNavPlugin } from "./plugins/ControlledHistoryNavPlugin";
import { ControlledValueBridgePlugin } from "./plugins/ControlledValueBridgePlugin";
import { EditorHandlePlugin } from "./plugins/EditorHandlePlugin";
import { HistoryNavPlugin } from "./plugins/HistoryNavPlugin";
import { PasteImagePlugin } from "./plugins/PasteImagePlugin";
import { TriggerPlugin } from "./plugins/TriggerPlugin";
import { ValueBridgePlugin } from "./plugins/ValueBridgePlugin";
import type { TriggerMatch } from "./tokens/trigger";

export interface InputEditorProps {
	ariaLabel: string;
	editable: boolean;
	namespace?: string;
	value?: string;
	history?: readonly string[];
	onValueChange?: (value: string) => void;
	persistenceId?: string | null;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onEnter: () => boolean;
	onFocusChange: (focused: boolean) => void;
	onTriggerChange?: (trigger: TriggerMatch | null) => void;
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
	namespace = "chat-input",
	value,
	history,
	onValueChange,
	persistenceId,
	onContextMenu,
	onEnter,
	onFocusChange,
	onTriggerChange,
}: InputEditorProps): JSX.Element {
	const controlled = value !== undefined && onValueChange !== undefined;
	return (
		<ConversationEditorView
			namespace={namespace}
			ariaLabel={ariaLabel}
			editable={editable}
			nodes={INPUT_EDITOR_NODES}
			onContextMenu={onContextMenu}
			onEnter={onEnter}
			onFocusChange={onFocusChange}
			plugins={
				<>
					<EditorHandlePlugin />
					{controlled ? (
						<>
						<ControlledValueBridgePlugin value={value} onValueChange={onValueChange} />
						<ControlledHistoryNavPlugin history={history ?? []} value={value} onValueChange={onValueChange} />
						{onTriggerChange ? <TriggerPlugin onTriggerChange={onTriggerChange} /> : null}
						<PasteImagePlugin local runtimeId={persistenceId} />
						</>
					) : (
						<>
						<ValueBridgePlugin />
						<HistoryNavPlugin />
						{onTriggerChange ? <TriggerPlugin onTriggerChange={onTriggerChange} /> : null}
						<PasteImagePlugin />
						</>
					)}
				</>
			}
		/>
	);
});
