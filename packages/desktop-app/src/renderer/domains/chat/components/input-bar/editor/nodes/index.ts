import type { Klass, LexicalNode } from "lexical";
import { FileTokenNode } from "./FileTokenNode";
import { ImageTokenNode } from "./ImageTokenNode";
import { SkillTokenNode } from "./SkillTokenNode";

/** 注册到 LexicalComposer 的自定义节点；漏注册会在运行时抛 "node type not registered"。 */
export const INPUT_EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [SkillTokenNode, FileTokenNode, ImageTokenNode];

export { $createFileTokenNode, $isFileTokenNode, FileTokenNode } from "./FileTokenNode";
export { $createImageTokenNode, $isImageTokenNode, ImageTokenNode } from "./ImageTokenNode";
export { $createSkillTokenNode, $isSkillTokenNode, SkillTokenNode } from "./SkillTokenNode";
