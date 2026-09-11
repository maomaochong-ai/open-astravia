import { ConversationEditorView } from "@shared/components/conversation-editor/ConversationEditorView";
import type { InputSegment } from "@shared/lib/input-tokens";
import { memo, type MouseEvent } from "react";
import { INPUT_EDITOR_NODES } from "./nodes";
import { ControlledHistoryNavPlugin } from "./plugins/ControlledHistoryNavPlugin";
import { ControlledValueBridgePlugin } from "./plugins/ControlledValueBridgePlugin";
import { EditorHandlePlugin } from "./plugins/EditorHandlePlugin";
import { HistoryNavPlugin } from "./plugins/HistoryNavPlugin";
import { PasteImagePlugin } from "./plugins/PasteImagePlugin";
import { StructuredClipboardPlugin } from "./plugins/StructuredClipboardPlugin";
import { TriggerPlugin } from "./plugins/TriggerPlugin";
import { ValueBridgePlugin } from "./plugins/ValueBridgePlugin";
import type { TriggerMatch } from "./tokens/trigger";

export interface InputEditorProps {
	ariaLabel: string;
	editable: boolean;
	namespace?: string;
	value?: string;
	segments?: readonly InputSegment[];
	history?: readonly string[];
	onValueChange?: (value: string, segments?: readonly InputSegment[]) => void;
	persistenceId?: string | null;
	onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	onEnter: (event?: KeyboardEvent) => boolean;
	onFocusChange: (focused: boolean) => void;
	onTriggerChange?: (trigger: TriggerMatch | null) => void;
}

/**
 * 多模态输入区：文本与 skill / 文件 / 图片 token 同处一条文本流。
 *
 * 用 PlainTextPlugin 而非 RichText——需要的只有「单段文本 + 软换行 + 行内原子节点」，
 * 富文本格式化命令一概不要；同一应用内的 token 粘贴走结构化剪贴板，外部内容才按纯文本回退。
 * contenteditable 随内容自然增高，因此旧 textarea 那套 scrollHeight 手动测量
 * 与「先归零再读高」的防抖 hack 一并去掉了。
 */
export const InputEditor = memo(function InputEditor({
	ariaLabel,
	editable,
	namespace = "chat-input",
	value,
	segments,
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
						<ControlledValueBridgePlugin value={value} segments={segments} onValueChange={onValueChange} />
						<ControlledHistoryNavPlugin history={history ?? []} value={value} onValueChange={onValueChange} />
						{onTriggerChange ? <TriggerPlugin onTriggerChange={onTriggerChange} /> : null}
						<StructuredClipboardPlugin />
						<PasteImagePlugin local runtimeId={persistenceId} />
						</>
					) : (
						<>
						<ValueBridgePlugin />
						<HistoryNavPlugin />
						{onTriggerChange ? <TriggerPlugin onTriggerChange={onTriggerChange} /> : null}
						<StructuredClipboardPlugin />
						<PasteImagePlugin />
						</>
					)}
				</>
			}
		/>
	);
});
