import type { OrchestrationEvent, OrchestrationReadModel } from "@xbetools/contracts";
import {
  createEmptyReadModel as createSharedEmptyReadModel,
  OrchestrationProjectorError as SharedOrchestrationProjectorError,
  projectEvent as projectSharedEvent,
} from "@xbetools/shared/orchestration-projector";
import { Effect } from "effect";

import { OrchestrationProjectorDecodeError } from "./Errors.ts";

export const createEmptyReadModel = createSharedEmptyReadModel;

function toProjectorError(
  eventType: OrchestrationEvent["type"],
  error: SharedOrchestrationProjectorError,
): OrchestrationProjectorDecodeError {
  return new OrchestrationProjectorDecodeError({
    eventType,
    issue: error.issue,
    cause: error,
  });
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
) {
  return projectSharedEvent(model, event).pipe(
    Effect.mapError((error) => toProjectorError(event.type, error)),
  );
}
