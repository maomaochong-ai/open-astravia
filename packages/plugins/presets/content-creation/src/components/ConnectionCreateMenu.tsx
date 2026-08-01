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
		<div className="content-creation-connection-menu" style={{ left, top }}>
			<strong>{t("connectionMenu.title")}</strong>
			<p>{t("connectionMenu.description")}</p>
			<NodeDefinitionGrid definitions={definitions} onSelect={onSelect} />
		</div>
	);
}
