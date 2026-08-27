import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

const namespaceType = Type.String({
	pattern: "^(?!.*\\.\\.)[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$",
});
const identifierType = Type.String({ minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$" });
const requiredStringType = Type.String({ minLength: 1 });
const allowedHostType = Type.String({ minLength: 1, maxLength: 253, pattern: "\\S" });
const browserRuntimeStatusInputType = Type.Object({ namespace: namespaceType });

const browserRuntimePhaseType = Type.Union([
	Type.Literal("checking"),
	Type.Literal("missing"),
	Type.Literal("outdated"),
	Type.Literal("browser-missing"),
	Type.Literal("ready"),
	Type.Literal("installing-runtime"),
	Type.Literal("installing-browser"),
	Type.Literal("error"),
]);
const browserRuntimeStatusType = Type.Object({
	phase: browserRuntimePhaseType,
	version: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	recentOutput: Type.Optional(Type.String()),
});
const browserRuntimeInstallInputType = Type.Object({
	namespace: namespaceType,
	step: Type.Union([Type.Literal("runtime"), Type.Literal("browser")]),
});

const browserEphemeralProfileType = Type.Object({ type: Type.Literal("ephemeral") });
const browserPersistentProfileType = Type.Object({
	type: Type.Literal("persistent"),
	id: identifierType,
});
const browserSessionProfileType = Type.Union([browserEphemeralProfileType, browserPersistentProfileType]);
const browserSourceType = Type.Union([Type.Literal("managed"), Type.Literal("attach")]);
const browserSessionStatusType = Type.Union([
	Type.Literal("starting"),
	Type.Literal("ready"),
	Type.Literal("closed"),
	Type.Literal("error"),
]);
const browserSessionType = Type.Object({
	id: identifierType,
	source: browserSourceType,
	profile: browserSessionProfileType,
	headed: Type.Boolean(),
	status: browserSessionStatusType,
	createdAt: Type.Number(),
});
const browserSessionCreateInputType = Type.Object({
	namespace: namespaceType,
	source: Type.Optional(browserSourceType),
	profile: Type.Optional(browserSessionProfileType),
	headed: Type.Optional(Type.Boolean()),
	allowedHosts: Type.Array(allowedHostType, { minItems: 1, maxItems: 128 }),
});
const browserSessionInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
});
const browserNavigateInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
	url: Type.String({ minLength: 1, maxLength: 8192 }),
});
const browserPageStateType = Type.Object({
	sessionId: identifierType,
	revision: Type.Integer({ minimum: 0 }),
	url: Type.String(),
	title: Type.Optional(Type.String()),
});
const browserSnapshotInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
	interactiveOnly: Type.Optional(Type.Boolean()),
});
const browserSnapshotType = Type.Object({
	sessionId: identifierType,
	revision: Type.Integer({ minimum: 0 }),
	url: Type.String(),
	title: Type.Optional(Type.String()),
	content: Type.String(),
});
const browserReadTextInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
	maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
});
const browserTextContentType = Type.Object({
	sessionId: identifierType,
	url: Type.String(),
	title: Type.Optional(Type.String()),
	text: Type.String(),
	truncated: Type.Boolean(),
});
const browserScreenshotInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
	fullPage: Type.Optional(Type.Boolean()),
});
const browserScreenshotType = Type.Object({
	sessionId: identifierType,
	revision: Type.Integer({ minimum: 0 }),
	dataUrl: Type.String({ pattern: "^data:image/(png|jpeg);base64," }),
});

const targetType = Type.String({ minLength: 1, maxLength: 512 });
const browserActionType = Type.Union([
	Type.Object({ type: Type.Literal("click"), target: targetType }),
	Type.Object({ type: Type.Literal("fill"), target: targetType, value: Type.String() }),
	Type.Object({ type: Type.Literal("type"), target: targetType, value: Type.String() }),
	Type.Object({ type: Type.Literal("select"), target: targetType, value: requiredStringType }),
	Type.Object({ type: Type.Literal("check"), target: targetType, checked: Type.Boolean() }),
	Type.Object({ type: Type.Literal("press"), key: requiredStringType }),
	Type.Object({
		type: Type.Literal("scroll"),
		direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]),
		amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
	}),
	Type.Object({
		type: Type.Literal("wait"),
		milliseconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 120_000 })),
		target: Type.Optional(targetType),
	}),
	Type.Object({ type: Type.Literal("back") }),
	Type.Object({ type: Type.Literal("reload") }),
]);
const browserActInputType = Type.Object({
	namespace: namespaceType,
	sessionId: identifierType,
	snapshotRevision: Type.Optional(Type.Integer({ minimum: 0 })),
	action: browserActionType,
});
const browserActionResultType = Type.Object({
	sessionId: identifierType,
	revision: Type.Integer({ minimum: 0 }),
	url: Type.String(),
	title: Type.Optional(Type.String()),
	output: Type.Optional(Type.String()),
});

export type BrowserRuntimePhase = Static<typeof browserRuntimePhaseType>;
export type BrowserRuntimeStatusInput = Readonly<Static<typeof browserRuntimeStatusInputType>>;
export type BrowserRuntimeStatus = Readonly<Static<typeof browserRuntimeStatusType>>;
export type BrowserRuntimeInstallInput = Readonly<Static<typeof browserRuntimeInstallInputType>>;
export type BrowserSessionProfile = Readonly<Static<typeof browserSessionProfileType>>;
export type BrowserSource = Static<typeof browserSourceType>;
export type BrowserSessionStatus = Static<typeof browserSessionStatusType>;
export type BrowserSession = Readonly<Static<typeof browserSessionType>>;
export type BrowserSessionCreateInput = Readonly<Static<typeof browserSessionCreateInputType>>;
export type BrowserSessionInput = Readonly<Static<typeof browserSessionInputType>>;
export type BrowserNavigateInput = Readonly<Static<typeof browserNavigateInputType>>;
export type BrowserPageState = Readonly<Static<typeof browserPageStateType>>;
export type BrowserSnapshotInput = Readonly<Static<typeof browserSnapshotInputType>>;
export type BrowserSnapshot = Readonly<Static<typeof browserSnapshotType>>;
export type BrowserReadTextInput = Readonly<Static<typeof browserReadTextInputType>>;
export type BrowserTextContent = Readonly<Static<typeof browserTextContentType>>;
export type BrowserScreenshotInput = Readonly<Static<typeof browserScreenshotInputType>>;
export type BrowserScreenshot = Readonly<Static<typeof browserScreenshotType>>;
export type BrowserAction = Readonly<Static<typeof browserActionType>>;
export type BrowserActInput = Readonly<Static<typeof browserActInputType>>;
export type BrowserActionResult = Readonly<Static<typeof browserActionResultType>>;

const runtimeStatusOutput = defineCapabilityOutputSchema(browserRuntimeStatusType, { clean: true });
const runtimeStatusInput = defineCapabilityInputSchema(browserRuntimeStatusInputType, { clean: true });
const runtimeInstallInput = defineCapabilityInputSchema(browserRuntimeInstallInputType, { clean: true });
const sessionCreateInput = defineCapabilityInputSchema(browserSessionCreateInputType, { clean: true });
const sessionInput = defineCapabilityInputSchema(browserSessionInputType, { clean: true });
const navigateInput = defineCapabilityInputSchema(browserNavigateInputType, { clean: true });
const snapshotInput = defineCapabilityInputSchema(browserSnapshotInputType, { clean: true });
const readTextInput = defineCapabilityInputSchema(browserReadTextInputType, { clean: true });
const screenshotInput = defineCapabilityInputSchema(browserScreenshotInputType, { clean: true });
const actInput = defineCapabilityInputSchema(browserActInputType, { clean: true });
const sessionOutput = defineCapabilityOutputSchema(browserSessionType, { clean: true });
const pageStateOutput = defineCapabilityOutputSchema(browserPageStateType, { clean: true });
const snapshotOutput = defineCapabilityOutputSchema(browserSnapshotType, { clean: true });
const textContentOutput = defineCapabilityOutputSchema(browserTextContentType, { clean: true });
const screenshotOutput = defineCapabilityOutputSchema(browserScreenshotType, { clean: true });
const actionResultOutput = defineCapabilityOutputSchema(browserActionResultType, { clean: true });
const noOutput = defineCapabilityNoOutputSchema();

export const FOUNDATION_BROWSER_CAPABILITIES = {
	RUNTIME_STATUS: defineCapability<BrowserRuntimeStatusInput, BrowserRuntimeStatus>({
		id: "cap.foundation.vetta.browser.runtime-status",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: runtimeStatusInput,
		output: runtimeStatusOutput,
	}),
	RUNTIME_INSTALL: defineCapability<BrowserRuntimeInstallInput, BrowserRuntimeStatus>({
		id: "cap.foundation.vetta.browser.runtime-install",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: runtimeInstallInput,
		output: runtimeStatusOutput,
	}),
	SESSION_CREATE: defineCapability<BrowserSessionCreateInput, BrowserSession>({
		id: "cap.foundation.vetta.browser.session-create",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: sessionCreateInput,
		output: sessionOutput,
	}),
	SESSION_GET: defineCapability<BrowserSessionInput, BrowserSession>({
		id: "cap.foundation.vetta.browser.session-get",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: sessionInput,
		output: sessionOutput,
	}),
	SESSION_CLOSE: defineCapability<BrowserSessionInput, undefined>({
		id: "cap.foundation.vetta.browser.session-close",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: sessionInput,
		output: noOutput,
	}),
	NAVIGATE: defineCapability<BrowserNavigateInput, BrowserPageState>({
		id: "cap.foundation.vetta.browser.navigate",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: navigateInput,
		output: pageStateOutput,
	}),
	SNAPSHOT: defineCapability<BrowserSnapshotInput, BrowserSnapshot>({
		id: "cap.foundation.vetta.browser.snapshot",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: snapshotInput,
		output: snapshotOutput,
	}),
	READ_TEXT: defineCapability<BrowserReadTextInput, BrowserTextContent>({
		id: "cap.foundation.vetta.browser.read-text",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: readTextInput,
		output: textContentOutput,
	}),
	SCREENSHOT: defineCapability<BrowserScreenshotInput, BrowserScreenshot>({
		id: "cap.foundation.vetta.browser.screenshot",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: screenshotInput,
		output: screenshotOutput,
	}),
	ACT: defineCapability<BrowserActInput, BrowserActionResult>({
		id: "cap.foundation.vetta.browser.act",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: actInput,
		output: actionResultOutput,
	}),
} as const;

export const FOUNDATION_BROWSER_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_BROWSER_CAPABILITIES),
);
