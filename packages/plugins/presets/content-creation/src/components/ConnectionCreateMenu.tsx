import { useTranslation } from "@vetta-org/plugin-sdk";
import { CONTENT_NODE_DEFINITIONS } from "../domain/node-definitions";
import type { ContentNodeKind } from "../domain/model";
import { NodeDefinitionGrid } from "./NodeLibrary";

interface ConnectionCreateMenuProps {
	left: number;
	top: number;
	kinds: readonly ContentNodeKind[];
	onSelect: (kind: ContentNodeKind) => void;
}

export function ConnectionCreateMenu({ left, top, kinds, onSelect }: ConnectionCreateMenuProps) {
	const { t } = useTranslation();
	const definitions = CONTENT_NODE_DEFINITIONS.filter((definition) => kinds.includes(definition.kind));

	return (
		<div className="absolute z-50 w-[320px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl" style={{ left, top }}>
			<div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">{t("connectionMenu.title")}</div>
			<p className="px-3 pt-2 text-xs text-muted-foreground">{t("connectionMenu.description")}</p>
			<NodeDefinitionGrid definitions={definitions} onSelect={onSelect} />
		</div>
	);
}
