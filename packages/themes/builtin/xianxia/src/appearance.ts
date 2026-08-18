import type { ThemeAppearance, ThemeSurfaceFrame } from "@vetta/theme-sdk";
import { xianxiaAssets } from "./assets";

const xianxiaPanelFrame: ThemeSurfaceFrame = {
	kind: "nine-slice-image",
	imageUrl: xianxiaAssets.newSessionScenePanel,
	decoration: {
		borderWidth: "18px",
		outset: "2px",
		repeat: "stretch",
		slice: 122,
	},
};

const xianxiaPanelSurface = {
	frame: xianxiaPanelFrame,
	surfaceClassName: "overflow-visible",
};

export const xianxiaAppearance: ThemeAppearance = {
	colorScheme: "light",
	colors: {
		common: {
			accent: "rgb(219, 223, 236)",
			accentForeground: "rgb(45, 51, 73)",
			background: "rgb(225, 230, 242)",
			border: "rgb(196, 202, 219)",
			card: "rgb(244, 245, 249)",
			cardForeground: "rgb(39, 45, 67)",
			chart1: "rgb(105, 117, 153)",
			chart2: "rgb(87, 142, 151)",
			chart3: "rgb(190, 144, 82)",
			chart4: "rgb(139, 105, 161)",
			chart5: "rgb(176, 92, 88)",
			destructive: "rgb(176, 74, 70)",
			destructiveForeground: "rgb(255, 255, 255)",
			foreground: "rgb(39, 45, 67)",
			input: "rgb(202, 208, 224)",
			muted: "rgb(232, 235, 244)",
			mutedForeground: "rgb(99, 106, 128)",
			popover: "rgb(246, 247, 251)",
			popoverForeground: "rgb(39, 45, 67)",
			primary: "rgb(105, 117, 153)",
			primaryForeground: "rgb(255, 255, 255)",
			ring: "rgb(127, 139, 174)",
			secondary: "rgb(230, 233, 242)",
			secondaryForeground: "rgb(48, 54, 76)",
		},
	},
	surfaces: {
		"activity.panel": xianxiaPanelSurface,
		"app.frame": {
			frame: {
				kind: "background-image",
				imageUrl: xianxiaAssets.appBackground,
				decoration: {
					position: "center",
					repeat: "no-repeat",
					size: "cover",
				},
			},
			rootClassName: "xianxia-app-frame",
		},
		"app.frameOverlay": {
			surfaceClassName: "xianxia-app-frame-overlay",
		},
		"sidebar.panel": {
			rootClassName: "xianxia-sidebar-background border-transparent bg-primary-foreground/80",
		},
		"sidebar.navigationIndicator": {
			frame: {
				kind: "nine-slice-image",
				imageUrl: xianxiaAssets.buttonBackground,
				decoration: {
					borderWidth: "8px",
					outset: "3px",
					repeat: "stretch",
					slice: 90,
				},
			},
		},
		"chat.atPanel": xianxiaPanelSurface,
		"chat.assistantMessage": {
			frame: xianxiaPanelFrame,
			rootClassName: "border-transparent bg-transparent px-4 py-3",
			surfaceClassName: "overflow-visible",
		},
		"chat.newSessionPage": { rootClassName: "bg-transparent" },
		"chat.sessionViewerPage": { rootClassName: "bg-transparent" },
		"chat.view": { rootClassName: "bg-transparent" },
		"chat.executionModeMenu": xianxiaPanelSurface,
		"chat.inputActionBar": {
			rootClassName: "mx-auto w-[93%]",
		},
		"chat.inputBar": {
			frame: {
				kind: "nine-slice-image",
				imageUrl: xianxiaAssets.newSessionInputPanel,
				decoration: {
					borderWidth: "24px 36px 28px",
					outset: "2px",
					repeat: "stretch",
					slice: "96 126 112",
				},
			},
			rootClassName: "xianxia-input-bar-background border-transparent bg-transparent dark:bg-transparent",
			surfaceClassName: "z-[2] overflow-visible",
		},
		"chat.inputBarToolbarLeft": {
			rootClassName: "xianxia-input-bar-toolbar-left",
		},
		"chat.inputBarToolbarRight": {
			rootClassName: "xianxia-input-bar-toolbar-right",
		},
		"chat.sendButton": {
			frame: {
				kind: "background-image",
				imageUrl: xianxiaAssets.sendButtonFrame,
				decoration: {
					position: "center",
					repeat: "no-repeat",
					size: "40px 40px",
				},
			},
			rootClassName: "xianxia-send-button",
			surfaceClassName: "xianxia-frame-glow-silver -inset-1 z-20 overflow-visible",
		},
		"chat.inputDrawer": xianxiaPanelSurface,
		"chat.modelSelectorMenu": xianxiaPanelSurface,
		"chat.modelSelectorReasoningMenu": xianxiaPanelSurface,
		"chat.newSessionGuidingWords": {
			rootClassName: "xianxia-guiding-words border-transparent bg-card/80",
			surfaceClassName: "xianxia-guiding-words-frame overflow-visible",
		},
		"chat.newSessionSceneCard": {
			frame: {
				kind: "nine-slice-image",
				imageUrl: xianxiaAssets.newSessionScenePanel,
				decoration: {
					borderWidth: "18px",
					outset: "2px",
					repeat: "stretch",
					slice: 122,
				},
			},
			rootClassName: "xianxia-scene-card-background border-transparent bg-transparent",
			surfaceClassName: "overflow-visible",
		},
		"chat.newSessionSkillCard": {
			frame: {
				kind: "horizontal-slice-image",
				imageUrl: xianxiaAssets.newSessionSkillPanel,
				decoration: {
					height: "100%",
					leftSlice: 245,
					leftWidth: "28px",
					rightSlice: 245,
					rightWidth: "28px",
				},
			},
			rootClassName: "xianxia-skill-card-background border-transparent bg-transparent",
			surfaceClassName: "overflow-visible",
		},
		"chat.projectSelectorMenu": xianxiaPanelSurface,
		"chat.questionPanel": xianxiaPanelSurface,
		"chat.slashPanel": xianxiaPanelSurface,
		"root.confirmDialog.panel": xianxiaPanelSurface,
		"root.filePreviewDialog": xianxiaPanelSurface,
		"root.filePreviewDialog.panel": xianxiaPanelSurface,
		"root.flowingSendDialog.panel": xianxiaPanelSurface,
		"root.genericActionApproval.panel": xianxiaPanelSurface,
		"root.knowledgeDropOverlay": xianxiaPanelSurface,
		"root.loginDialog.panel": xianxiaPanelSurface,
		"root.approval.appearance.panel": xianxiaPanelSurface,
		"root.approval.batchTasks.panel": xianxiaPanelSurface,
		"root.approval.manage.panel": xianxiaPanelSurface,
		"root.approval.navigationOpen.panel": xianxiaPanelSurface,
		"root.approval.schedulerAction.panel": xianxiaPanelSurface,
		"root.approval.schedulerEdit.panel": xianxiaPanelSurface,
		"root.updateRestartDialog.panel": xianxiaPanelSurface,
		"root.workflowCompleteDialog.panel": xianxiaPanelSurface,
		"settings.pageContent": { rootClassName: "bg-transparent" },
	},
};
