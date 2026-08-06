import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical";
import { useEffect, useRef } from "react";

export interface SubmitPluginProps {
	/** 返回 true 表示这次回车已被当作发送处理。 */
	onEnter: () => boolean;
}

/**
 * Enter 发送、Shift+Enter 换行。
 * 输入法组合期（中文选字）的回车必须放过，否则选字就变成发送。
 * 面板打开时的回车不会到这里——面板在 document 捕获阶段就 stopPropagation 了。
 *
 * 回调走 ref：onEnter 的身份随 canSend / isEmpty 变化，直接进 deps 会让命令
 * 反复注销重注册。
 */
export function SubmitPlugin({ onEnter }: SubmitPluginProps): null {
	const [editor] = useLexicalComposerContext();
	const onEnterRef = useRef(onEnter);
	onEnterRef.current = onEnter;

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (event === null) return false;
				if (event.shiftKey || event.isComposing) return false;
				if (!onEnterRef.current()) return false;
				event.preventDefault();
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [editor]);

	return null;
}
