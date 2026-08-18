import type { ToolCallBlock } from "@shared/store/atoms";
import { ToolCallBlockView } from "@vetta/theme-ui/chat";
import { useToolCallBlockModel } from "../../hooks/useToolCallBlockModel";

interface ToolCallBlockProps {
	block: ToolCallBlock;
	exportMode?: boolean;
	/** Work 模式传 true：工具名走 i18n 语义别名。 */
	aliased?: boolean;
}

export function ToolCallBlockViewHost({ block, exportMode = false, aliased = false }: ToolCallBlockProps): JSX.Element {
	const model = useToolCallBlockModel(block, exportMode, aliased);
	return <ToolCallBlockView {...model} />;
}

export { ToolCallBlockViewHost as ToolCallBlockView };
