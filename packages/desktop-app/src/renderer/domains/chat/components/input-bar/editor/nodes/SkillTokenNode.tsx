import { skillTokenText } from "@shared/lib/input-tokens";
import { SkillTypeIcon } from "@vetta/theme-ui/skills";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { TokenChip } from "./TokenChip";

export type SerializedSkillTokenNode = Spread<
	{ name: string; alias?: string; icon?: string },
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
	/** 市场目录里的图标（`solar:xxx` 或图片 URL）；缺省时落 skill 默认图。 */
	__icon?: string;

	static getType(): string {
		return "skill-token";
	}

	static clone(node: SkillTokenNode): SkillTokenNode {
		return new SkillTokenNode(node.__name, node.__alias, node.__icon, node.__key);
	}

	constructor(name: string, alias?: string, icon?: string, key?: NodeKey) {
		super(key);
		this.__name = name;
		this.__alias = alias;
		this.__icon = icon;
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
		return $createSkillTokenNode(serialized.name, serialized.alias, serialized.icon);
	}

	exportJSON(): SerializedSkillTokenNode {
		return {
			...super.exportJSON(),
			name: this.__name,
			...(this.__alias ? { alias: this.__alias } : {}),
			...(this.__icon ? { icon: this.__icon } : {}),
		};
	}

	decorate(): JSX.Element {
		return (
			<TokenChip
				iconNode={<SkillTypeIcon type="skill" icon={this.__icon} className="h-3 w-3" />}
				label={this.__alias || this.__name}
				title={this.__name}
			/>
		);
	}
}

export function $createSkillTokenNode(name: string, alias?: string, icon?: string): SkillTokenNode {
	return new SkillTokenNode(name, alias, icon);
}

export function $isSkillTokenNode(node: LexicalNode | null | undefined): node is SkillTokenNode {
	return node instanceof SkillTokenNode;
}
