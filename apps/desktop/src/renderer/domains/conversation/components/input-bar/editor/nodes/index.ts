import type { Klass, LexicalNode } from "lexical";
import { ConnectorTokenNode } from "./ConnectorTokenNode";
import { FileTokenNode } from "./FileTokenNode";
import { ImageTokenNode } from "./ImageTokenNode";
import { MemberTokenNode } from "./MemberTokenNode";
import { SkillTokenNode } from "./SkillTokenNode";

/** 注册到 LexicalComposer 的自定义节点；漏注册会在运行时抛 "node type not registered"。 */
export const INPUT_EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
	SkillTokenNode,
	ConnectorTokenNode,
	FileTokenNode,
	ImageTokenNode,
	MemberTokenNode,
];

export {
	$createConnectorTokenNode,
	$isConnectorTokenNode,
	ConnectorTokenNode,
} from "./ConnectorTokenNode";
export { $createFileTokenNode, $isFileTokenNode, FileTokenNode } from "./FileTokenNode";
export { $createImageTokenNode, $isImageTokenNode, ImageTokenNode } from "./ImageTokenNode";
export { $createMemberTokenNode, $isMemberTokenNode, MemberTokenNode } from "./MemberTokenNode";
export {
	$createSceneTokenNode,
	$createSkillTokenNode,
	$isSkillTokenNode,
	type AbilityTokenType,
	SkillTokenNode,
} from "./SkillTokenNode";
