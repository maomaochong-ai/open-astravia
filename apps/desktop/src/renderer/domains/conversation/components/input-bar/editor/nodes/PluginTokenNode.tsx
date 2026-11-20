import { pluginTokenText } from "@shared/lib/input-tokens";
import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { PluginTokenChip } from "./PluginTokenChip";

export type SerializedPluginTokenNode = Spread<{ name: string; label?: string; icon?: string }, SerializedLexicalNode>;

/**
 * 行内插件引用。
 *
 * 插件是能力包（工具 + 若干技能），不是一个可执行单元：把插件放进消息意味着
 * 「让 Agent 用这个包干活」，所以这里只记插件身份，不展开成包里某个技能
 * （见 ADR-0183）。文本形态 `@plugin:slug` 与 `@skill:` / `@mcp:` 同构。
 */
export class PluginTokenNode extends DecoratorNode<JSX.Element> {
	__name: string;
	/** 展示用名称（插件标题）；序列化只用真实 slug，否则模型对不上插件。 */
	__label?: string;
	/** 插件图标（图片 URL 或 `solar:xxx`）；缺省时落插件默认图。 */
	__icon?: string;

	static getType(): string {
		return "plugin-token";
	}

	static clone(node: PluginTokenNode): PluginTokenNode {
		return new PluginTokenNode(node.__name, node.__label, node.__icon, node.__key);
	}

	constructor(name: string, label?: string, icon?: string, key?: NodeKey) {
		super(key);
		this.__name = name;
		this.__label = label;
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

	/** 与技能令牌同一理由：方向键跨过去即可，不要切到 NodeSelection（见 SkillTokenNode）。 */
	isKeyboardSelectable(): false {
		return false;
	}

	getTextContent(): string {
		return pluginTokenText(this.__name);
	}

	getName(): string {
		return this.__name;
	}

	getLabel(): string | undefined {
		return this.__label;
	}

	getIcon(): string | undefined {
		return this.__icon;
	}

	static importJSON(serialized: SerializedPluginTokenNode): PluginTokenNode {
		return new PluginTokenNode(serialized.name, serialized.label, serialized.icon);
	}

	exportJSON(): SerializedPluginTokenNode {
		return {
			...super.exportJSON(),
			name: this.__name,
			...(this.__label ? { label: this.__label } : {}),
			...(this.__icon ? { icon: this.__icon } : {}),
		};
	}

	decorate(): JSX.Element {
		return <PluginTokenChip name={this.__name} label={this.__label} icon={this.__icon} />;
	}
}

export function $createPluginTokenNode(name: string, label?: string, icon?: string): PluginTokenNode {
	return new PluginTokenNode(name, label, icon);
}

export function $isPluginTokenNode(node: LexicalNode | null | undefined): node is PluginTokenNode {
	return node instanceof PluginTokenNode;
}
