import type { SkillInfo } from "@preload/api";
import type { AppshotAttachment } from "@shared/store/atoms";
import type { TodoItem } from "@shared/store/todo-atoms";
import type { InputBarContextMenuViewProps } from "@vetta/theme-ui/chat";
import type { ComponentProps, MouseEvent } from "react";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import type { SelectedFile } from "../AtPanel";
import type { QuestionPanel } from "../QuestionPanel";
import type { ActiveActionCapsule } from "./ActiveActionCapsules";
import type { TriggerMatch } from "./editor/tokens/trigger";

export interface InputBarProps {
	onSend: (overrideText?: string) => Promise<void>;
	onAbort: () => Promise<void>;
	onSendQueued?: (runtimeId: string, id: string) => void;
	/**
	 * 当无 activeSession 但仍希望放行输入与发送时（例如 NewSessionPage），
	 * 把该项目的 cwd 传进来：InputBar 把它视为「有会话」、@ 文件面板用它作为根目录。
	 */
	cwdOverride?: string;
	/**
	 * 命令区展开 / 收起时回调。命令区向上生长，宿主可以据此腾出空间
	 * （新会话页把整条输入栏下移，避免下方留白过大）。
	 */
	onExpandedChange?: (expanded: boolean) => void;
}

export interface InputBarLabels {
	capsule: {
		removeDefault: string;
		removeImage: string;
		removeTooltip: (path: string) => string;
		/** 多个 input action 折叠成一枚胶囊时的文案，如「3 个插件」。 */
		activeGroup: (count: number) => string;
	};
	permission: {
		deny: string;
		allow: string;
		allowSession: string;
	};
	toolbar: {
		skills: string;
		addImage: string;
		attachFile: string;
		queue: string;
	};
}

export interface SandboxPermissionRequestModel {
	title: string;
	message: string;
	sensitive?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	onAllowSession?: () => void;
}

export type InputBarDrawerItem =
	| {
			kind: "sandbox-permission";
			id: string;
			label: string;
			desc: string;
			pulsing: boolean;
			request: SandboxPermissionRequestModel;
	  }
	| {
			kind: "queue";
			id: string;
			label: string;
			desc: string;
			runtimeId: string;
			onSendNow: (id: string) => void;
	  }
	| {
			kind: "todo";
			id: string;
			label: string;
			desc: string;
			pulsing: boolean;
			items: readonly TodoItem[];
			onViewMore: () => void;
	  };

export interface InputBarModel {
	isStreaming: boolean;
	pendingQuestion: ComponentProps<typeof QuestionPanel>["pending"] | undefined;
	firstSuggestion?: string;
	/** 输入卡片上方的图片缩略图行；label 与文本流里的「图 N」胶囊同源。 */
	imageAttachments: ReadonlyArray<{ path: string; name: string; url: string; label: string }>;
	/** 已激活的 input action；全量开关在命令面板里，这里只留激活提示。 */
	activeActions: readonly ActiveActionCapsule[];
	/** 仅场景（scene）：它走 promptRef 硬展开，不进文本流，用顶部胶囊展示。 */
	selectedSkill: { name: string; alias?: string; type: string } | null;
	appshotAttachment: AppshotAttachment | null;
	hasSession: boolean;
	canSend: boolean;
	isEmpty: boolean;
	/** 输入框无任何字符（含空格）时展示覆盖层 placeholder；与原生行为一致 */
	showPlaceholder: boolean;
	hasCapsules: boolean;
	effectiveCwd: string;
	/** 空输入时展示的占位文案；多条时垂直轮播 */
	placeholderTexts: readonly string[];
	/** 是否对 placeholderTexts 做自动上下切换（suggestion/thinking 等为 false） */
	placeholderRotating: boolean;
	isFocused: boolean;
	slashOpen: boolean;
	/**
	 * 命令区是否还在屏上（含退场动画期间）。
	 * 输入卡片的圆角与上边框跟它走而不是 `slashOpen`：两块面是一整块，`slashOpen`
	 * 一变卡片就立刻恢复圆角，命令区还没退完，接缝处会露出两个缺口。
	 */
	slashVisible: boolean;
	slashFilter: string;
	atOpen: boolean;
	/** `@` 触发词原文（含 `@`），AtPanel 用它过滤。 */
	atFilter: string;
	drawerItems: InputBarDrawerItem[];
	drawerActiveTab: string | null;
	hasPromptAttachment: boolean;
	promptAttachmentIcon?: string;
	promptAttachmentLabel?: string;
	/** 逐条渲染的条目名；插件没给 `labels` 时就是 `[promptAttachmentLabel]`。 */
	promptAttachmentLabels?: string[];
	/** Latest user message replacement pending (applied on send). */
	pendingMessageEdit: boolean;
	pendingEditHint: string;
	cancelPendingEditLabel: string;
	/** 输入区右键剪切/复制/粘贴菜单；关闭时为 null。 */
	contextMenu: InputBarContextMenuViewProps | null;
	labels: InputBarLabels;
	actions: {
		setFocused: (focused: boolean) => void;
		setDrawerActiveTab: (tabId: string | null) => void;
		/** 回车键；返回 true 表示已当作发送处理，编辑器不再插换行。 */
		handleEnter: () => boolean;
		/** 编辑器上报光标前的 `/` / `@` 触发词。 */
		handleTriggerChange: (trigger: TriggerMatch | null) => void;
		handleContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
		handleSlashClose: () => void;
		/** icon 由命令区从市场目录解析后带下来，行内胶囊沿用同一张图。 */
		handleSlashSelect: (skill: SkillInfo, icon?: string) => void;
		/** 面板里点连接器宫格：插入一个 `@mcp:名字` 行内 token。 */
		handleConnectorSelect: (connector: ConnectorGridItem) => void;
		handleAtClose: () => void;
		handleAtSelect: (file: SelectedFile) => void;
		removeSkill: () => void;
		/** 从文本流里删掉该图片的 token（缩略图行的 × 按钮）。 */
		removeImage: (path: string) => void;
		openImagePreview: (index: number) => void;
		removePromptAttachment: () => void;
		removeAppshot: () => void;
		handlePlusClick: () => void;
		handleSelectImages: () => Promise<void>;
		handleSelectFiles: () => Promise<void>;
		handleSend: () => void;
		handleAbort: () => void;
		cancelPendingEdit: () => void;
	};
}

export interface InputBarViewClassNames {
	root?: string;
	stack?: string;
	card?: string;
	cardContent?: string;
	capsules?: string;
	editorWrap?: string;
	toolbar?: string;
}

export interface InputBarViewProps {
	model: InputBarModel;
	className?: string;
	classNames?: InputBarViewClassNames;
}
