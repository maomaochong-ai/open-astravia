import { skillTokenText } from "@shared/lib/input-tokens";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedSkillTokenNode = Spread<
	{ name: string; alias?: string },
	SerializedLexicalNode
>;

/**
 * 行内 skill 引用。软引用：文本里只留 `@skill:名字`，
 * 由模型自行决定是否 invoke_skill，宿主不做硬展开。
 */
export class SkillTokenNode extends DecoratorNode<JSX.Element> {
	__name: string;
	/** 展示用别名；序列化仍用真实 name，否则模型查不到这个 skill。 */
	__alias?: string;

	static getType(): string {
		return "skill-token";
	}

	static clone(node: SkillTokenNode): SkillTokenNode {
		return new SkillTokenNode(node.__name, node.__alias, node.__key);
	}

	constructor(name: string, alias?: string, key?: NodeKey) {
		super(key);
		this.__name = name;
		this.__alias = alias;
	}

	createDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "align-middle";
		return span;
	}

	updateDOM(): false {
		return false;
	}

	isInline(): true {
		return true;
	}

	isKeyboardSelectable(): true {
		return true;
	}

	getTextContent(): string {
		return skillTokenText(this.__name);
	}

	getName(): string {
		return this.__name;
	}

	static importJSON(serialized: SerializedSkillTokenNode): SkillTokenNode {
		return $createSkillTokenNode(serialized.name, serialized.alias);
	}

	exportJSON(): SerializedSkillTokenNode {
		return {
			...super.exportJSON(),
			name: this.__name,
			...(this.__alias ? { alias: this.__alias } : {}),
		};
	}

	decorate(): JSX.Element {
		return (
			<TokenChip
				icon="icon-[solar--magic-stick-linear]"
				label={this.__alias || this.__name}
				title={this.__name}
			/>
		);
	}
}

export function $createSkillTokenNode(name: string, alias?: string): SkillTokenNode {
	return new SkillTokenNode(name, alias);
}

export function $isSkillTokenNode(node: LexicalNode | null | undefined): node is SkillTokenNode {
	return node instanceof SkillTokenNode;
}
