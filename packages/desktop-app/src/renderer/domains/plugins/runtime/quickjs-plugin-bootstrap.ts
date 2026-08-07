export const QUICKJS_PLUGIN_BOOTSTRAP = `
(() => {
  "use strict";
  const emitHost = globalThis.__vettaHostEmit;
  delete globalThis.__vettaHostEmit;
  let activationHandler;
  let deactivationHandler;
  let settings = Object.create(null);
  let locale = "zh";
  let nextCallId = 1;
  const pendingCalls = new Map();
  const actionHandlers = new Map();
  const settingsHandlers = new Set();
  const localeHandlers = new Set();

  const serializeError = (error) => {
    if (error && typeof error === "object") {
      return String(error.stack || error.message || error);
    }
    return String(error);
  };
  const emit = (message) => emitHost(JSON.stringify(message));
  const reportError = (error) => emit({ type: "error", message: serializeError(error) });
  const callHost = (method, args) => new Promise((resolve, reject) => {
    const callId = nextCallId++;
    pendingCalls.set(callId, { resolve, reject });
    emit({ type: "hostCall", callId, method, args });
  });

  const ui = Object.freeze({
    registerActivityTab: (contribution) => emit({ type: "registerActivityTab", contribution }),
    updateActivityTab: (tabId, view) => emit({ type: "updateActivityTab", tabId, view }),
    onAction: (action, handler) => {
      if (typeof action !== "string" || typeof handler !== "function") {
        throw new TypeError("ui.onAction requires an action id and function");
      }
      actionHandlers.set(action, handler);
    },
    openActivityTab: (tabId, options) => emit({ type: "openActivityTab", tabId, width: options?.width }),
    setActivityTabVisible: (tabId, visible) => emit({ type: "setActivityTabVisible", tabId, visible }),
    notify: (options) => emit({ type: "notify", options }),
  });
  const storage = Object.freeze({
    readJson: (key) => callHost("storage.readJson", [key]),
    writeJson: (key, value) => callHost("storage.writeJson", [key, value]),
    list: (prefix) => callHost("storage.list", [prefix]),
    readFile: (path) => callHost("storage.readFile", [path]),
    writeFile: (path, data) => callHost("storage.writeFile", [path, data]),
    putBlob: (input) => callHost("storage.putBlob", [input]),
    readBlob: (id) => callHost("storage.readBlob", [id]),
    getBlobRef: (id) => callHost("storage.getBlobRef", [id]),
  });
  const settingsApi = Object.freeze({
    get: (key) => settings[key],
    getAll: () => ({ ...settings }),
    onChange: (handler) => {
      if (typeof handler !== "function") throw new TypeError("settings.onChange requires a function");
      settingsHandlers.add(handler);
    },
  });
  const i18n = Object.freeze({
    get locale() { return locale; },
    t: (key, params) => callHost("i18n.t", [key, params]),
    onChange: (handler) => {
      if (typeof handler !== "function") throw new TypeError("i18n.onChange requires a function");
      localeHandlers.add(handler);
    },
  });
  let context;

  const vetta = Object.freeze({
    activate: (handler) => {
      if (activationHandler) throw new Error("QuickJS plugin activation handler is already registered");
      if (typeof handler !== "function") throw new TypeError("vetta.activate requires a function");
      activationHandler = handler;
    },
    deactivate: (handler) => {
      if (typeof handler !== "function") throw new TypeError("vetta.deactivate requires a function");
      deactivationHandler = handler;
    },
  });
  Object.defineProperty(globalThis, "vetta", { value: vetta, writable: false, configurable: false });

  const defineInternal = (name, value) => {
    Object.defineProperty(globalThis, name, { value, writable: false, configurable: false });
  };
  defineInternal("__vettaInitialize", (input) => {
    settings = { ...input.settings };
    locale = input.locale;
    const permissionSet = new Set(input.permissions);
    context = Object.freeze({
      plugin: Object.freeze({ ...input.plugin }),
      permissions: Object.freeze({ has: (permission) => permissionSet.has(permission) }),
      ui,
      network: Object.freeze({ request: (request) => callHost("network.request", [request]) }),
      storage,
      settings: settingsApi,
      i18n,
    });
  });
  defineInternal("__vettaRunActivate", () => {
    if (!activationHandler) throw new Error("QuickJS plugin must call vetta.activate(handler)");
    activationHandler(context);
  });
  defineInternal("__vettaDispatchAction", (event) => {
    const handler = actionHandlers.get(event.action);
    if (!handler) throw new Error("QuickJS action handler not found: " + event.action);
    Promise.resolve(handler(event)).catch(reportError);
  });
  defineInternal("__vettaResolveHostCall", (callId, ok, value) => {
    const pending = pendingCalls.get(callId);
    if (!pending) return;
    pendingCalls.delete(callId);
    if (ok) pending.resolve(value);
    else pending.reject(new Error(String(value)));
  });
  defineInternal("__vettaSettingsChanged", (values) => {
    settings = { ...values };
    for (const handler of settingsHandlers) Promise.resolve(handler({ ...settings })).catch(reportError);
  });
  defineInternal("__vettaLocaleChanged", (value) => {
    locale = value;
    for (const handler of localeHandlers) Promise.resolve(handler(locale)).catch(reportError);
  });
  defineInternal("__vettaRunDeactivate", () => {
    if (deactivationHandler) deactivationHandler();
    pendingCalls.clear();
    actionHandlers.clear();
    settingsHandlers.clear();
    localeHandlers.clear();
  });
})();
`;
