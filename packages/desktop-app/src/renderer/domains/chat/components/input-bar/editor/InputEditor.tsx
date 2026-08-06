import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { memo, type MouseEvent } from "react";
import { INPUT_EDITOR_NODES } from "./nodes";
import { EditorHandlePlugin } from "./plugins/EditorHandlePlugin";
import { HistoryNavPlugin } from "./plugins/HistoryNavPlugin";
import { PasteImagePlugin } from "./plugins/PasteImagePlugin";
import { SubmitPlugin } from "./plugins/SubmitPlugin";
import { TriggerPlugin } from "./plugins/TriggerPlugin";
import { ValueBridgePlugin } from "./plugins/ValueBridgePlugin";
import type { TriggerMatch } from "./tokens/trigger";

const MIN_HEIGHT = 24;
const MAX_HEIGHT = 140;

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
		<LexicalComposer
			initialConfig={{
				namespace: "chat-input",
				nodes: [...INPUT_EDITOR_NODES],
				editable,
				onError: (error) => {
					console.error("[input-editor]", error);
				},
				theme: {},
			}}
		>
			<PlainTextPlugin
				contentEditable={
					<ContentEditable
						aria-label={ariaLabel}
						className="w-full resize-none whitespace-pre-wrap break-words bg-transparent text-[13.5px] leading-[1.6] text-foreground outline-none data-[editable=false]:cursor-not-allowed"
						style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, overflowY: "auto" }}
						onFocus={() => onFocusChange(true)}
						onBlur={() => onFocusChange(false)}
						onContextMenu={onContextMenu}
					/>
				}
				// placeholder 由 InputBarView 的覆盖层组件负责（支持轮播文案）。
				placeholder={null}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<HistoryPlugin />
			<EditorHandlePlugin editable={editable} />
			<ValueBridgePlugin />
			<HistoryNavPlugin />
			<TriggerPlugin onTriggerChange={onTriggerChange} />
			<SubmitPlugin onEnter={onEnter} />
			<PasteImagePlugin />
		</LexicalComposer>
	);
});
