import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import {
  clearCloudAuthToken,
  createCloudAuthRequest,
  fetchCloudAuth,
  getCloudAuthToken,
  setCloudAuthToken,
} from "./methods/cloudAuth.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  getSavedEnvironmentRegistry,
  getSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  setSavedEnvironmentRegistry,
  setSavedEnvironmentSecret,
} from "./methods/savedEnvironments.ts";
import {
  getAdvertisedEndpoints,
  getServerExposureState,
  setServerExposureMode,
  setTailscaleServeEnabled,
} from "./methods/serverExposure.ts";
import {
  bootstrapSshBearerSession,
  disconnectSshEnvironment,
  discoverSshHosts,
  ensureSshEnvironment,
  fetchSshEnvironmentDescriptor,
  fetchSshSessionState,
  issueSshWebSocketTicket,
  resolveSshPasswordPrompt,
} from "./methods/sshEnvironment.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  confirm,
  getAppBranding,
  getLocalEnvironmentBootstrap,
  openExternal,
  pickFolder,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";
import {
  browserBack,
  browserForward,
  browserHide,
  browserNavigate,
  browserOpenPopout,
  browserReload,
  browserShow,
} from "./methods/browser.ts";
import {
  githubAuthGetStoredState,
  githubAuthPollForToken,
  githubAuthSignOut,
  githubAuthStartDeviceFlow,
} from "./methods/githubAuth.ts";
import { bootstrapPrototypesProject } from "./methods/projectBootstrap.ts";
import {
  sortlyQuickCreate,
  sortlyQuickDelete,
  sortlyQuickInfo,
  sortlyQuickPublish,
  sortlyQuickPublishState,
} from "./methods/sortlyQuick.ts";

export const installDesktopIpcHandlers = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getLocalEnvironmentBootstrap);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getSavedEnvironmentRegistry);
  yield* ipc.handle(setSavedEnvironmentRegistry);
  yield* ipc.handle(getSavedEnvironmentSecret);
  yield* ipc.handle(setSavedEnvironmentSecret);
  yield* ipc.handle(removeSavedEnvironmentSecret);

  yield* ipc.handle(discoverSshHosts);
  yield* ipc.handle(ensureSshEnvironment);
  yield* ipc.handle(disconnectSshEnvironment);
  yield* ipc.handle(fetchSshEnvironmentDescriptor);
  yield* ipc.handle(bootstrapSshBearerSession);
  yield* ipc.handle(fetchSshSessionState);
  yield* ipc.handle(issueSshWebSocketTicket);
  yield* ipc.handle(resolveSshPasswordPrompt);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(setServerExposureMode);
  yield* ipc.handle(setTailscaleServeEnabled);
  yield* ipc.handle(getAdvertisedEndpoints);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(confirm);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);

  yield* ipc.handle(browserShow);
  yield* ipc.handle(browserHide);
  yield* ipc.handle(browserNavigate);
  yield* ipc.handle(browserBack);
  yield* ipc.handle(browserForward);
  yield* ipc.handle(browserReload);
  yield* ipc.handle(browserOpenPopout);

  yield* ipc.handle(createCloudAuthRequest);
  yield* ipc.handle(getCloudAuthToken);
  yield* ipc.handle(setCloudAuthToken);
  yield* ipc.handle(clearCloudAuthToken);
  yield* ipc.handle(fetchCloudAuth);
  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);

  yield* ipc.handle(githubAuthStartDeviceFlow);
  yield* ipc.handle(githubAuthPollForToken);
  yield* ipc.handle(githubAuthGetStoredState);
  yield* ipc.handle(githubAuthSignOut);
  yield* ipc.handle(bootstrapPrototypesProject);
  yield* ipc.handle(sortlyQuickCreate);
  yield* ipc.handle(sortlyQuickInfo);
  yield* ipc.handle(sortlyQuickPublish);
  yield* ipc.handle(sortlyQuickPublishState);
  yield* ipc.handle(sortlyQuickDelete);
}).pipe(Effect.withSpan("desktop.ipc.installHandlers"));
