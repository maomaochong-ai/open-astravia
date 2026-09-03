import { SuggestionBubblesView } from "@vetta/theme-ui/chat";
import { useSuggestionBubblesModel } from "../hooks/useSuggestionBubblesModel";

interface SuggestionBubblesProps {
	/** 点击建议直发：以建议文本作为独立 prompt 立即发送。 */
	onSend: (overrideText?: string) => Promise<void>;
}

/**
 * 输入预测建议气泡：渲染在 MessageList 下方、InputBar 上方，垂直排列 0-3 个。
 * 点击即把该建议作为独立 prompt 直发。建议为空时整块不渲染动画内容。
 */
export function SuggestionBubbles({ onSend }: SuggestionBubblesProps): JSX.Element {
	const model = useSuggestionBubblesModel();

	return (
		<SuggestionBubblesView
			suggestions={model.suggestions}
			sendTooltip={model.sendTooltip}
			onSend={(text) => void onSend(text)}
		/>
	);
}
