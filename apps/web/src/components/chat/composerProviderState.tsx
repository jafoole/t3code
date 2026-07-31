import {
  type ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
} from "@t3tools/shared/model";
import type { ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import {
  isProviderInstanceSendable,
  resolveSelectableProviderInstanceFromEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { getProviderModelCapabilities } from "../../providerModels";
import { shouldRenderTraitsControls, TraitsMenuContent, TraitsPicker } from "./TraitsPicker";

export type ComposerProviderStateInput = {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  promptInjectionState?: ComposerPromptInjectionState;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
};

export type ComposerPromptInjectionState = "none" | "ultrathink";

export type ComposerProviderState = {
  provider: ProviderDriverKind;
  promptEffort: string | null;
  modelOptionsForDispatch: ReadonlyArray<ProviderOptionSelection> | undefined;
  composerFrameClassName?: string;
  composerSurfaceClassName?: string;
  modelPickerIconClassName?: string;
};

type TraitsRenderInput = {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  prompt: string;
  onPromptChange: (prompt: string) => void;
};

export function getComposerPromptInjectionState(prompt: string): ComposerPromptInjectionState {
  return isClaudeUltrathinkPrompt(prompt) ? "ultrathink" : "none";
}

export function getComposerProviderState(input: ComposerProviderStateInput): ComposerProviderState {
  const { provider, model, models, modelOptions, promptInjectionState = "none" } = input;
  const caps = getProviderModelCapabilities(models, model, provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: modelOptions });
  const primarySelectDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<(typeof descriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const primaryValue = getProviderOptionCurrentValue(primarySelectDescriptor ?? null);
  const promptEffort = typeof primaryValue === "string" ? primaryValue : null;
  const ultrathinkActive =
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    promptInjectionState === "ultrathink";

  return {
    provider,
    promptEffort,
    modelOptionsForDispatch: buildProviderOptionSelectionsFromDescriptors(descriptors),
    ...(ultrathinkActive
      ? {
          composerFrameClassName: "ultrathink-frame",
          composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
          modelPickerIconClassName: "ultrathink-chroma",
        }
      : {}),
  };
}

export type ComposerInstanceSelectionInput = {
  /** Configured instances, settings overlay already applied. */
  entries: ReadonlyArray<ProviderInstanceEntry>;
  /** The user's unsaved pick from the model picker. */
  draftActiveProvider: ProviderInstanceId | null;
  /** The live session's routing instance (never substituted mid-session). */
  sessionInstanceId: ProviderInstanceId | null;
  /** Thread's persisted instance id (server-side saved selection). */
  threadInstanceId: ProviderInstanceId | null;
  /** Project default's instance id. */
  projectDefaultInstanceId: ProviderInstanceId | null;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey: string | null;
  /** Driver kind the composer resolved for the current selection. */
  selectedProvider: ProviderDriverKind;
};

/**
 * Resolve which configured instance the composer is targeting.
 * Priority:
 *   1. The user's unsaved pick from the model picker (must win when it is
 *      sendable, otherwise the UI appears to ignore picker selections).
 *   2. The live session's instance, the thread's persisted instance, then
 *      the project default — each only when sendable (enabled, installed,
 *      available; see `isProviderInstanceSendable`).
 *   3. A live session's instance verbatim, even when no longer sendable —
 *      the server routes follow-up turns by the session's instance, so
 *      swapping it out mid-thread would break continuation. The provider
 *      error surface, not silent rerouting, owns that failure mode.
 *   4. First sendable entry matching the current driver kind.
 *   5. First sendable entry overall (`resolveSelectableProviderInstance`
 *      semantics), then first enabled / first known entry as a last resort.
 *
 * Step 2 is what keeps a stale explicit selection — e.g. a project default
 * naming a disabled or uninstalled instance — from being dispatched
 * verbatim and rejected by `ProviderService.startSession`.
 */
export function resolveComposerSelectedInstanceId(
  input: ComposerInstanceSelectionInput,
): ProviderInstanceId {
  const {
    entries,
    draftActiveProvider,
    sessionInstanceId,
    threadInstanceId,
    projectDefaultInstanceId,
    lockedProvider,
    lockedContinuationGroupKey,
    selectedProvider,
  } = input;
  const candidates: Array<ProviderInstanceId | null> = [
    draftActiveProvider,
    sessionInstanceId,
    threadInstanceId,
    projectDefaultInstanceId,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = entries.find((entry) => entry.instanceId === candidate);
    if (!match || !isProviderInstanceSendable(match)) continue;
    // When locked to a specific driver kind, ignore persisted instance
    // ids from a different kind or continuation group.
    if (lockedProvider && match.driverKind !== lockedProvider) continue;
    if (lockedContinuationGroupKey && match.continuationGroupKey !== lockedContinuationGroupKey) {
      continue;
    }
    return match.instanceId;
  }
  if (sessionInstanceId) {
    return sessionInstanceId;
  }
  const byKind = entries.find(
    (entry) =>
      isProviderInstanceSendable(entry) &&
      entry.driverKind === selectedProvider &&
      (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey),
  );
  if (byKind) return byKind.instanceId;
  const anySendable = resolveSelectableProviderInstanceFromEntries(entries, undefined);
  if (anySendable) return anySendable;
  const anyEnabled = entries.find((entry) => entry.enabled);
  return (
    anyEnabled?.instanceId ??
    entries[0]?.instanceId ??
    threadInstanceId ??
    projectDefaultInstanceId ??
    ProviderInstanceId.make("codex")
  );
}

function renderTraitsControl(
  Component: typeof TraitsMenuContent | typeof TraitsPicker,
  input: TraitsRenderInput,
): ReactNode {
  const {
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    models,
    modelOptions,
    prompt,
    onPromptChange,
  } = input;
  const hasTarget = threadRef !== undefined || draftId !== undefined;
  if (
    !hasTarget ||
    !shouldRenderTraitsControls({ provider, models, model, modelOptions, prompt })
  ) {
    return null;
  }
  return (
    <Component
      provider={provider}
      {...(instanceId ? { instanceId } : {})}
      models={models}
      {...(threadRef ? { threadRef } : {})}
      {...(draftId ? { draftId } : {})}
      model={model}
      modelOptions={modelOptions}
      prompt={prompt}
      onPromptChange={onPromptChange}
    />
  );
}

export function renderProviderTraitsMenuContent(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsMenuContent, input);
}

export function renderProviderTraitsPicker(input: TraitsRenderInput): ReactNode {
  return renderTraitsControl(TraitsPicker, input);
}
