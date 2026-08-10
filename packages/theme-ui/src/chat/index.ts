import "../registry";
import type { ComponentType } from "react";
import type { InputBarBackground } from "./InputBarBackground";
import type { InputBarPlaceholder } from "./InputBarPlaceholder";
import type {
	NewSessionGuidingWordsProps,
	NewSessionHeroProps,
	NewSessionSceneCarouselProps,
	NewSessionSkillBadgeRowProps,
} from "./NewSession";
import type { SceneCard } from "./SceneCard";
import type { SkillCard } from "./SkillCard";

declare module "@vetta/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "chat.inputBarBackground"?: typeof InputBarBackground;
		readonly "chat.inputBarPlaceholder"?: typeof InputBarPlaceholder;
		readonly "chat.newSessionGuidingWords"?: ComponentType<NewSessionGuidingWordsProps>;
		readonly "chat.newSessionHero"?: ComponentType<NewSessionHeroProps>;
		readonly "chat.newSessionSceneCard"?: typeof SceneCard;
		readonly "chat.newSessionSceneCarousel"?: ComponentType<NewSessionSceneCarouselProps>;
		readonly "chat.newSessionSkillBadgeRow"?: ComponentType<NewSessionSkillBadgeRowProps>;
		readonly "chat.newSessionSkillCard"?: typeof SkillCard;
	}
}

export type { ActionButtonBarItem, ActionButtonBarViewProps } from "./ActionButtonBarView";
export { ActionButtonBarView } from "./ActionButtonBarView";
export type { AppshotCardViewLabels, AppshotCardViewProps } from "./AppshotCardView";
export { AppshotCardView } from "./AppshotCardView";
export type {
	AskUserQuestionItem,
	AskUserQuestionOption,
	AskUserQuestionViewLabels,
	AskUserQuestionViewProps,
} from "./AskUserQuestionView";
export { AskUserQuestionView } from "./AskUserQuestionView";
export type {
	AssistantMessageViewLabels,
	AssistantMessageViewProps,
} from "./AssistantMessageView";
export { AssistantMessageView, StreamingIndicator } from "./AssistantMessageView";
export type {
	AtPanelClassNames,
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelViewProps,
} from "./AtPanelView";
export { AtPanelView } from "./AtPanelView";
export type { BackgroundTasksBadgeViewProps } from "./BackgroundTasksBadgeView";
export { BackgroundTasksBadgeView } from "./BackgroundTasksBadgeView";
export type {
	BashBackgroundTaskView,
	BashTerminalCardLabels,
	BashTerminalCardProps,
	BashTerminalStatus,
} from "./BashTerminalCard";
export { BashBackgroundTaskTailView, BashTerminalCard } from "./BashTerminalCard";
export type { ChatExportHostViewProps } from "./ChatExportHostView";
export { ChatExportHostView } from "./ChatExportHostView";
export type { ChatHeaderActionsViewProps } from "./ChatHeaderActionsView";
export { ChatHeaderActionsView } from "./ChatHeaderActionsView";
export type { ContextRingViewProps } from "./ContextRingView";
export { CIRCUMFERENCE as CONTEXT_RING_CIRCUMFERENCE, ContextRingView } from "./ContextRingView";
export type { CopyIconButtonLabels, CopyIconButtonProps } from "./CopyIconButton";
export { CopyIconButton } from "./CopyIconButton";
export {
	DefaultGuidingWords,
	NEW_SESSION_GUIDING_WORDS_SLOT_MIN_H_CLASS,
} from "./DefaultGuidingWords";
export {
	DefaultSceneCarousel,
	NEW_SESSION_SCENE_SLOT_MIN_H_CLASS,
} from "./DefaultSceneCarousel";
export {
	DefaultSkillBadgeRow,
	NEW_SESSION_SKILL_BADGE_SLOT_MIN_H_CLASS,
} from "./DefaultSkillBadgeRow";
export type { DrawerCardProps, DrawerTab } from "./DrawerCard";
export { DrawerCard } from "./DrawerCard";
export type {
	AnchorEditItemView,
	AnchorEditsFallbackViewProps,
	DiffLineKind,
	DiffLineView,
	DiffPreviewViewProps,
	EditTextFallbackViewProps,
} from "./EditDiffView";
export { AnchorEditsFallbackView, DiffPreviewView, EditTextFallbackView } from "./EditDiffView";
export type {
	ExecutionModeOptionView,
	ExecutionModeSelectorViewProps,
} from "./ExecutionModeSelectorView";
export { ExecutionModeSelectorView } from "./ExecutionModeSelectorView";
export type {
	GuideBadgeSwiperViewLabels,
	GuideBadgeSwiperViewProps,
	GuideBadgeViewItem,
} from "./GuideBadgeSwiperView";
export { GuideBadgeSwiperView } from "./GuideBadgeSwiperView";
export type {
	InputActionBarItemView,
	InputActionBarViewModel,
	InputActionBarViewProps,
} from "./InputActionBarView";
export { InputActionBarView } from "./InputActionBarView";
export type { InputBarBackgroundProps } from "./InputBarBackground";
export { InputBarBackground } from "./InputBarBackground";
export type { InputBarCapsuleLabels, InputBarCapsuleProps } from "./InputBarCapsule";
export { InputBarCapsule } from "./InputBarCapsule";
export type {
	InputBarContextMenuViewLabels,
	InputBarContextMenuViewProps,
} from "./InputBarContextMenuView";
export { InputBarContextMenuView } from "./InputBarContextMenuView";
export type {
	InputBarPlaceholderClassNames,
	InputBarPlaceholderProps,
} from "./InputBarPlaceholder";
export { InputBarPlaceholder } from "./InputBarPlaceholder";
export type { InputBarToolbarButtonProps } from "./InputBarToolbarButton";
export { InputBarToolbarButton } from "./InputBarToolbarButton";
export type {
	KbFilterByTagsViewProps,
	KbFilterPageItem,
	KbListTagsViewProps,
	KbTagItem,
	KbWritePageViewProps,
} from "./KnowledgeToolViews";
export { KbFilterByTagsView, KbListTagsView, KbWritePageView } from "./KnowledgeToolViews";
export type { CopyButtonLabels } from "./MessageActions";
export {
	CopyButton,
	formatDuration,
	formatRelativeTime,
	formatTime,
	RelativeTimeLabel,
} from "./MessageActions";
export type { SegmentShellProps, ToolCallGroupViewProps } from "./MessageBlockSegmentsView";
export { ErrorBlockView, SegmentShell, ToolCallGroupView } from "./MessageBlockSegmentsView";
export type { MessageCardsHostViewProps } from "./MessageCardsHostView";
export { MessageCardsHostView } from "./MessageCardsHostView";
export type {
	MessageCardsTabItem,
	MessageCardsViewLabels,
	MessageCardsViewProps,
} from "./MessageCardsView";
export { MessageCardsView } from "./MessageCardsView";
export type {
	CompactionBoundaryViewProps,
	ExportMessageListViewProps,
	ForkOriginBannerViewProps,
	MessageItemViewProps,
	ModelSwitchBoundaryViewProps,
} from "./MessageItemView";
export {
	CompactionBoundaryView,
	ExportMessageListView,
	ForkOriginBannerView,
	MessageItemView,
	ModelSwitchBoundaryView,
} from "./MessageItemView";
export type { MessageListFooterViewProps } from "./MessageListFooterView";
export { MessageListFooterView } from "./MessageListFooterView";
export type { MessageListViewProps } from "./MessageListView";
export { MessageListView, VirtuosoListContainer } from "./MessageListView";
export type {
	MessageSelectionContextMenuViewLabels,
	MessageSelectionContextMenuViewProps,
} from "./MessageSelectionContextMenuView";
export { MessageSelectionContextMenuView } from "./MessageSelectionContextMenuView";
export type {
	NewSessionGuidingWordsGroup,
	NewSessionGuidingWordsProps,
	NewSessionHeroProps,
	NewSessionSceneActionState,
	NewSessionSceneCarouselLabels,
	NewSessionSceneCarouselProps,
	NewSessionSceneItem,
	NewSessionSelection,
	NewSessionSkillBadgeRowLabels,
	NewSessionSkillBadgeRowProps,
	NewSessionSkillItem,
	NewSessionSkillSelection,
} from "./NewSession";
export { NewSessionBackground } from "./NewSessionBackground";
export type { NewSessionPageLayoutViewProps } from "./NewSessionPageLayoutView";
export { NewSessionPageLayoutView } from "./NewSessionPageLayoutView";
export type { ProgressGroupRowProps, ProgressGroupViewProps } from "./ProgressGroupView";
export { ProgressGroupRow, ProgressGroupView } from "./ProgressGroupView";
export type {
	QueueCardItem,
	QueueCardPausedBanner,
	QueueCardViewLabels,
	QueueCardViewProps,
} from "./QueueCardView";
export { QueueCardView } from "./QueueCardView";
export type { ReadImageViewProps } from "./ReadImageView";
export { ReadImageView } from "./ReadImageView";
export type {
	SandboxGrantsBadgeViewLabels,
	SandboxGrantsBadgeViewProps,
	SandboxGrantViewItem,
} from "./SandboxGrantsBadgeView";
export { SandboxGrantsBadgeView } from "./SandboxGrantsBadgeView";
export type {
	SandboxPermissionCardLabels,
	SandboxPermissionCardProps,
	SandboxPermissionRequestModel,
} from "./SandboxPermissionCard";
export { SandboxPermissionCard } from "./SandboxPermissionCard";
export type {
	SceneCardActionState,
	SceneCardClassNames,
	SceneCardModel,
	SceneCardProps,
	SceneCardState,
} from "./SceneCard";
export { SceneCard } from "./SceneCard";
export type { SendButtonLabels, SendButtonProps } from "./SendButton";
export { SendButton } from "./SendButton";
export type {
	SessionDropDragKind,
	SessionDropZoneViewLabels,
	SessionDropZoneViewProps,
} from "./SessionDropZoneView";
export { SessionDropZoneView } from "./SessionDropZoneView";
export type { SessionViewerPageViewProps } from "./SessionViewerPageView";
export { SessionViewerPageView } from "./SessionViewerPageView";
export type { SkillCardClassNames, SkillCardModel, SkillCardProps } from "./SkillCard";
export { SkillCard } from "./SkillCard";
export type {
	SkillPromptAreaViewLabels,
	SkillPromptAreaViewProps,
} from "./SkillPromptAreaView";
export { SkillPromptAreaView } from "./SkillPromptAreaView";
export type { SuggestionBubblesViewProps } from "./SuggestionBubblesView";
export { SuggestionBubblesView } from "./SuggestionBubblesView";
export type {
	InlineTokenPiece,
	InlineTokenSupport,
	TextBlockViewLabels,
	TextBlockViewProps,
} from "./TextBlockView";
export { TextBlockView } from "./TextBlockView";
export type { TextPreviewLabels, TextPreviewProps } from "./TextPreview";
export { TextPreview } from "./TextPreview";
export type { ThinkingBlockViewLabels, ThinkingBlockViewProps } from "./ThinkingBlockView";
export { ThinkingBlockView } from "./ThinkingBlockView";
export type { TodoCardItem, TodoCardLabels, TodoCardProps } from "./TodoCard";
export { TodoCard } from "./TodoCard";
export type { ToolCallBlockViewProps } from "./ToolCallBlockView";
export { ToolCallBlockView } from "./ToolCallBlockView";
export type { UsageBarViewProps } from "./UsageBarView";
export { UsageBarView } from "./UsageBarView";
export type {
	UserMessageContextMenuViewLabels,
	UserMessageContextMenuViewProps,
} from "./UserMessageContextMenuView";
export { UserMessageContextMenuView } from "./UserMessageContextMenuView";
export type {
	UserMessageEntryState,
	UserMessageViewLabels,
	UserMessageViewProps,
} from "./UserMessageView";
export {
	SettingsAssistBadgeView,
	SkillBadgeView,
	UserMessageView,
} from "./UserMessageView";
export type {
	UseHorizontalDragScrollOptions,
	UseHorizontalDragScrollResult,
} from "./useHorizontalDragScroll";
export { useHorizontalDragScroll } from "./useHorizontalDragScroll";
export type { WorkflowFooterItem, WorkflowFooterItemsViewProps } from "./WorkflowFooterItemsView";
export { WorkflowFooterItemsView } from "./WorkflowFooterItemsView";
export type { WriteContentViewProps } from "./WriteContentView";
export { WriteContentView } from "./WriteContentView";
