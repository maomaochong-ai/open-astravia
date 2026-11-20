import {
	focusInputEditor,
	replaceInputSegments,
} from "@domains/conversation/components/input-bar/editor/inputEditorHandle";
import { SuggestionBubblesView } from "@astravia-org/theme-ui/chat";
import { useSuggestionBubblesModel } from "../hooks/useSuggestionBubblesModel";

interface SuggestionBubblesProps {
	/** 点击建议直发：以建议文本作为独立 prompt 立即发送。 */
	onSend: (overrideText?: string) => Promise<void>;
}

/**
 * 输入预测建议气泡：渲染在 MessageList 下方、InputBar 上方，垂直排列 0-3 个。
 *
 * 两条路径：点条目本体直接发；悬停浮出的「编辑」把建议填进输入框，让用户改完再发。
 * 建议为空时整块不渲染动画内容。
 */
export function SuggestionBubbles({ onSend }: SuggestionBubblesProps): JSX.Element {
	const model = useSuggestionBubblesModel();

	return (
		<SuggestionBubblesView
			suggestions={model.suggestions}
			sendTooltip={model.sendTooltip}
			editTooltip={model.editTooltip}
			// 编辑＝把建议落到输入框：替换而不是追加，避免上一次的草稿与新建议混在一起。
			onEdit={(text) => {
				replaceInputSegments([{ kind: "text", text }]);
				focusInputEditor();
			}}
			onSend={(text) => void onSend(text)}
		/>
	);
}
