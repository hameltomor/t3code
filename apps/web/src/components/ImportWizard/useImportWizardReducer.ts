import { useReducer } from "react";
import type {
  HistoryImportConversationSummary,
  HistoryImportConversationPreview,
  HistoryImportExecuteResult,
  HistoryImportProvider,
  HistoryImportLinkMode,
  ProviderInteractionMode,
  RuntimeMode,
} from "@xbetools/contracts";

export type WizardStep = "provider-select" | "session-list" | "preview" | "options" | "result";

export interface ImportOptions {
  title: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  linkMode: HistoryImportLinkMode;
}

export interface WizardState {
  step: WizardStep;
  providerFilter: HistoryImportProvider | null;
  selectedSession: HistoryImportConversationSummary | null;
  preview: HistoryImportConversationPreview | null;
  importOptions: ImportOptions;
  result: HistoryImportExecuteResult | null;
  error: string | null;
}

export type WizardAction =
  | { type: "SET_PROVIDER_FILTER"; filter: HistoryImportProvider | null }
  | { type: "GO_TO_SESSION_LIST" }
  | { type: "SELECT_SESSION"; session: HistoryImportConversationSummary }
  | { type: "SET_PREVIEW"; preview: HistoryImportConversationPreview }
  | { type: "GO_TO_OPTIONS" }
  | { type: "UPDATE_OPTIONS"; options: Partial<ImportOptions> }
  | { type: "SET_RESULT"; result: HistoryImportExecuteResult }
  | { type: "SET_ERROR"; error: string }
  | { type: "GO_BACK" }
  | { type: "RESET" };

function initialState(defaultModel: string): WizardState {
  return {
    step: "provider-select",
    providerFilter: null,
    selectedSession: null,
    preview: null,
    importOptions: {
      title: "",
      model: defaultModel,
      runtimeMode: "full-access",
      interactionMode: "default",
      linkMode: "native-resume",
    },
    result: null,
    error: null,
  };
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_PROVIDER_FILTER":
      return { ...state, providerFilter: action.filter };

    case "GO_TO_SESSION_LIST":
      return { ...state, step: "session-list" };

    case "SELECT_SESSION":
      return {
        ...state,
        selectedSession: action.session,
        importOptions: {
          ...state.importOptions,
          title: action.session.title,
          linkMode: action.session.linkMode,
          ...(action.session.model ? { model: action.session.model } : {}),
        },
      };

    case "SET_PREVIEW":
      return { ...state, step: "preview", preview: action.preview };

    case "GO_TO_OPTIONS":
      return { ...state, step: "options" };

    case "UPDATE_OPTIONS":
      return {
        ...state,
        importOptions: { ...state.importOptions, ...action.options },
      };

    case "SET_RESULT":
      return { ...state, step: "result", result: action.result };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "GO_BACK": {
      switch (state.step) {
        case "result":
          return { ...state, step: "options", result: null };
        case "options":
          return { ...state, step: "preview" };
        case "preview":
          return {
            ...state,
            step: "session-list",
            preview: null,
            selectedSession: null,
          };
        case "session-list":
          return { ...state, step: "provider-select" };
        default:
          return state;
      }
    }

    case "RESET":
      return initialState(state.importOptions.model);

    default:
      return state;
  }
}

export function useImportWizardReducer(defaultModel: string) {
  return useReducer(wizardReducer, defaultModel, initialState);
}
