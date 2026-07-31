import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
  resolveComposerSelectedInstanceId,
  type ComposerInstanceSelectionInput,
} from "./composerProviderState";

// Everything in composerProviderState is now data-driven by the model's
// optionDescriptors, so these tests use a single synthetic provider/model and
// vary only the descriptor shape per scenario.

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

const ULTRATHINK_FRAME_CLASSES = {
  composerFrameClassName: "ultrathink-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
  modelPickerIconClassName: "ultrathink-chroma",
} as const;

describe("getComposerProviderState", () => {
  it("derives a stable prompt injection state for ordinary prompt edits", () => {
    expect(getComposerPromptInjectionState("Investigate this failure")).toBe("none");
    expect(getComposerPromptInjectionState("Ultrathink:\nInvestigate this failure")).toBe(
      "ultrathink",
    );
  });

  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("adds ultrathink class names when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ...ULTRATHINK_FRAME_CLASSES,
    });
  });

  it("does not add ultrathink class names when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: undefined,
    });

    expect(state).not.toHaveProperty("composerFrameClassName");
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    expect(state).not.toHaveProperty("modelPickerIconClassName");
  });
});

function providerSnapshot(input: {
  provider: ProviderDriverKind;
  instanceId: string;
  enabled?: boolean;
  installed?: boolean;
  availability?: ServerProvider["availability"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: input.provider,
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: null,
    status: "ready",
    ...(input.availability ? { availability: input.availability } : {}),
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

function selectionInput(
  providers: ReadonlyArray<ServerProvider>,
  overrides: Partial<Omit<ComposerInstanceSelectionInput, "entries">> = {},
): ComposerInstanceSelectionInput {
  return {
    entries: deriveProviderInstanceEntries(providers),
    draftActiveProvider: null,
    sessionInstanceId: null,
    threadInstanceId: null,
    projectDefaultInstanceId: null,
    lockedProvider: null,
    lockedContinuationGroupKey: null,
    selectedProvider: CODEX,
    ...overrides,
  };
}

describe("resolveComposerSelectedInstanceId", () => {
  it("respects an explicit selection that is enabled and installed", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex" }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          projectDefaultInstanceId: ProviderInstanceId.make("claudeAgent"),
        }),
      ),
    ).toBe("claudeAgent");
  });

  it("falls back to an enabled instance when the project default is disabled", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex", enabled: false }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          projectDefaultInstanceId: ProviderInstanceId.make("codex"),
        }),
      ),
    ).toBe("claudeAgent");
  });

  it("falls back when the explicit selection is not installed", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex", installed: false }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          threadInstanceId: ProviderInstanceId.make("codex"),
        }),
      ),
    ).toBe("claudeAgent");
  });

  it("falls back when the explicit selection references a removed instance", () => {
    const providers = [providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" })];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          projectDefaultInstanceId: ProviderInstanceId.make("removed_instance"),
        }),
      ),
    ).toBe("claudeAgent");
  });

  it("prefers a sendable instance of the current driver kind when falling back", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex", enabled: false }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
      providerSnapshot({ provider: CODEX, instanceId: "codex_personal" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          projectDefaultInstanceId: ProviderInstanceId.make("codex"),
          selectedProvider: CODEX,
        }),
      ),
    ).toBe("codex_personal");
  });

  it("lets the user's picker selection win over thread and project defaults", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex" }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          draftActiveProvider: ProviderInstanceId.make("claudeAgent"),
          threadInstanceId: ProviderInstanceId.make("codex"),
          projectDefaultInstanceId: ProviderInstanceId.make("codex"),
        }),
      ),
    ).toBe("claudeAgent");
  });

  it("keeps a live session's instance even when it is no longer sendable", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex", enabled: false }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent" }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          sessionInstanceId: ProviderInstanceId.make("codex"),
          threadInstanceId: ProviderInstanceId.make("codex"),
        }),
      ),
    ).toBe("codex");
  });

  it("returns a stable id without crashing when no provider is enabled", () => {
    const providers = [
      providerSnapshot({ provider: CODEX, instanceId: "codex", enabled: false }),
      providerSnapshot({ provider: CLAUDE, instanceId: "claudeAgent", enabled: false }),
    ];

    expect(
      resolveComposerSelectedInstanceId(
        selectionInput(providers, {
          projectDefaultInstanceId: ProviderInstanceId.make("codex"),
        }),
      ),
    ).toBe("codex");
  });

  it("degrades to the codex default when no providers are known at all", () => {
    expect(resolveComposerSelectedInstanceId(selectionInput([]))).toBe("codex");
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      model: MODEL,
      models,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });
});
