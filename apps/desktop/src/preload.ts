import type { DesktopBridge } from "@t3tools/contracts";
import { contextBridge, ipcRenderer } from "electron";

import * as IpcChannels from "./ipc/channels.ts";

function unwrapEnsureSshEnvironmentResult(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    result.type === IpcChannels.SSH_PASSWORD_PROMPT_CANCELLED_RESULT
  ) {
    const message =
      "message" in result && typeof result.message === "string"
        ? result.message
        : "SSH authentication cancelled.";
    throw new Error(message);
  }
  return result as Awaited<ReturnType<DesktopBridge["ensureSshEnvironment"]>>;
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),
  getSavedEnvironmentRegistry: () =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(IpcChannels.SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, { environmentId, secret }),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(IpcChannels.REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL),
  ensureSshEnvironment: async (target, options) =>
    unwrapEnsureSshEnvironmentResult(
      await ipcRenderer.invoke(IpcChannels.ENSURE_SSH_ENVIRONMENT_CHANNEL, {
        target,
        ...(options === undefined ? {} : { options }),
      }),
    ),
  disconnectSshEnvironment: (target) =>
    ipcRenderer.invoke(IpcChannels.DISCONNECT_SSH_ENVIRONMENT_CHANNEL, target),
  fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL, { httpBaseUrl }),
  bootstrapSshBearerSession: (httpBaseUrl, credential) =>
    ipcRenderer.invoke(IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL, {
      httpBaseUrl,
      credential,
    }),
  fetchSshSessionState: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL, { httpBaseUrl, bearerToken }),
  issueSshWebSocketTicket: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL, { httpBaseUrl, bearerToken }),
  onSshPasswordPrompt: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (typeof request !== "object" || request === null) return;
      listener(request as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    };
  },
  resolveSshPasswordPrompt: (requestId, password) =>
    ipcRenderer.invoke(IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, { requestId, password }),
  getServerExposureState: () => ipcRenderer.invoke(IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  setTailscaleServeEnabled: (input) =>
    ipcRenderer.invoke(IpcChannels.SET_TAILSCALE_SERVE_ENABLED_CHANNEL, input),
  getAdvertisedEndpoints: () => ipcRenderer.invoke(IpcChannels.GET_ADVERTISED_ENDPOINTS_CHANNEL),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  confirm: (message) => ipcRenderer.invoke(IpcChannels.CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  browserShow: (input) => ipcRenderer.invoke(IpcChannels.BROWSER_SHOW_CHANNEL, input),
  browserHide: () => ipcRenderer.invoke(IpcChannels.BROWSER_HIDE_CHANNEL),
  browserSetBounds: (bounds) => {
    ipcRenderer.send(IpcChannels.BROWSER_SET_BOUNDS_CHANNEL, bounds);
  },
  browserNavigate: (url: string) => ipcRenderer.invoke(IpcChannels.BROWSER_NAVIGATE_CHANNEL, url),
  browserBack: () => ipcRenderer.invoke(IpcChannels.BROWSER_BACK_CHANNEL),
  browserForward: () => ipcRenderer.invoke(IpcChannels.BROWSER_FORWARD_CHANNEL),
  browserReload: () => ipcRenderer.invoke(IpcChannels.BROWSER_RELOAD_CHANNEL),
  browserOpenPopout: (url: string, options?: { readonly focus?: boolean }) =>
    ipcRenderer.invoke(IpcChannels.BROWSER_OPEN_POPOUT_CHANNEL, {
      url,
      ...(options?.focus === undefined ? {} : { focus: options.focus }),
    }),
  browserFocusPopout: () => ipcRenderer.invoke(IpcChannels.BROWSER_FOCUS_POPOUT_CHANNEL),
  onBrowserState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.BROWSER_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(IpcChannels.BROWSER_STATE_CHANNEL, wrapped);
    };
  },
  onExternalLinkRequest: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, url: unknown) => {
      if (typeof url !== "string") return;
      listener(url);
    };
    ipcRenderer.on(IpcChannels.BROWSER_EXTERNAL_LINK_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(IpcChannels.BROWSER_EXTERNAL_LINK_CHANNEL, wrapped);
    };
  },
  createCloudAuthRequest: () => ipcRenderer.invoke(IpcChannels.CREATE_CLOUD_AUTH_REQUEST_CHANNEL),
  getCloudAuthToken: () => ipcRenderer.invoke(IpcChannels.GET_CLOUD_AUTH_TOKEN_CHANNEL),
  setCloudAuthToken: (token: string) =>
    ipcRenderer.invoke(IpcChannels.SET_CLOUD_AUTH_TOKEN_CHANNEL, token),
  clearCloudAuthToken: () => ipcRenderer.invoke(IpcChannels.CLEAR_CLOUD_AUTH_TOKEN_CHANNEL),
  fetchCloudAuth: (input) => ipcRenderer.invoke(IpcChannels.FETCH_CLOUD_AUTH_CHANNEL, input),
  onCloudAuthCallback: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, rawUrl: unknown) => {
      if (typeof rawUrl !== "string") return;
      listener(rawUrl);
    };

    ipcRenderer.on(IpcChannels.CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.CLOUD_AUTH_CALLBACK_CHANNEL, wrappedListener);
    };
  },
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL),
  githubAuthStartDeviceFlow: () =>
    ipcRenderer.invoke(IpcChannels.GITHUB_AUTH_START_DEVICE_FLOW_CHANNEL),
  githubAuthPollForToken: (device_code, currentInterval) =>
    ipcRenderer.invoke(IpcChannels.GITHUB_AUTH_POLL_FOR_TOKEN_CHANNEL, {
      device_code,
      currentInterval,
    }),
  githubAuthGetStoredState: () =>
    ipcRenderer.invoke(IpcChannels.GITHUB_AUTH_GET_STORED_STATE_CHANNEL),
  githubAuthSignOut: () => ipcRenderer.invoke(IpcChannels.GITHUB_AUTH_SIGN_OUT_CHANNEL),
  githubBootstrapProject: (repo = "prototypes") =>
    ipcRenderer.invoke(IpcChannels.GITHUB_BOOTSTRAP_PROJECT_CHANNEL, repo),
  sortlyQuickCreate: (name: string) =>
    ipcRenderer.invoke(IpcChannels.SORTLY_QUICK_CREATE_CHANNEL, { name }),
  sortlyQuickInfo: (workspaceRoot: string) =>
    ipcRenderer.invoke(IpcChannels.SORTLY_QUICK_INFO_CHANNEL, { workspaceRoot }),
  sortlyQuickPublish: (workspaceRoot: string, publish: boolean, name?: string) =>
    ipcRenderer.invoke(IpcChannels.SORTLY_QUICK_PUBLISH_CHANNEL, { workspaceRoot, publish, name }),
  sortlyQuickPublishState: (workspaceRoot: string) =>
    ipcRenderer.invoke(IpcChannels.SORTLY_QUICK_PUBLISH_STATE_CHANNEL, { workspaceRoot }),
  sortlyQuickDelete: (workspaceRoot: string) =>
    ipcRenderer.invoke(IpcChannels.SORTLY_QUICK_DELETE_CHANNEL, { workspaceRoot }),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
