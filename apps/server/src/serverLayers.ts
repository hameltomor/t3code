import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { ServerConfig } from "./config";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { ProviderUnsupportedError } from "./provider/Errors";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import { makeClaudeCodeAdapterLive } from "./provider/Layers/ClaudeCodeAdapter";
import { makeGeminiAdapterLive } from "./provider/Layers/GeminiAdapter";
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { ProviderService } from "./provider/Services/ProviderService";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";

import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { KeybindingsLive } from "./keybindings";
import { ProjectionNotificationRepositoryLive } from "./persistence/Layers/ProjectionNotifications";
import { ProjectionPushSubscriptionRepositoryLive } from "./persistence/Layers/ProjectionPushSubscriptions";
import { ProjectionDraftRepositoryLive } from "./persistence/Layers/ProjectionDrafts";
import { WebPushServiceLive } from "./push/WebPushService";
import { GitManagerLive } from "./git/Layers/GitManager";
import { GitCoreLive } from "./git/Layers/GitCore";
import { ForgeCliResolverLive } from "./git/Layers/ForgeCliResolver";
import { CodexTextGenerationLive } from "./git/Layers/CodexTextGeneration";
import { GitServiceLive } from "./git/Layers/GitService";
import { WorkspaceRepoScannerLive } from "./git/Layers/WorkspaceRepoScanner";
import { BunPtyAdapterLive } from "./terminal/Layers/BunPTY";
import { NodePtyAdapterLive } from "./terminal/Layers/NodePTY";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { HistoryImportCatalogRepositoryLive } from "./persistence/Layers/HistoryImportCatalog";
import { ThreadExternalLinkRepositoryLive } from "./persistence/Layers/ThreadExternalLinks";
import { ClaudeCodeHistoryScannerLive } from "./historyImport/Layers/ClaudeCodeHistoryScanner";
import { ClaudeCodeSessionParserLive } from "./historyImport/Layers/ClaudeCodeSessionParser";
import { CodexHistoryScannerLive } from "./historyImport/Layers/CodexHistoryScanner";
import { CodexRolloutParserLive } from "./historyImport/Layers/CodexRolloutParser";
import { HistoryMaterializerLive } from "./historyImport/Layers/HistoryMaterializer";
import { HistoryImportServiceLive } from "./historyImport/Layers/HistoryImportService";
import { ProjectionUsageAggregateRepositoryLive } from "./persistence/Layers/ProjectionUsageAggregate";

export function makeServerProviderLayer(): Layer.Layer<
  ProviderService,
  ProviderUnsupportedError,
  SqlClient.SqlClient | ServerConfig | FileSystem.FileSystem | AnalyticsService
> {
  return Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const providerLogsDir = path.join(stateDir, "logs", "provider");
    const providerEventLogPath = path.join(providerLogsDir, "events.log");
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const claudeCodeAdapterLayer = makeClaudeCodeAdapterLive({
      stateDir,
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
    });
    const geminiAdapterLayer = makeGeminiAdapterLive({ stateDir });
    const adapterRegistryLayer = ProviderAdapterRegistryLive.pipe(
      Layer.provide(codexAdapterLayer),
      Layer.provide(claudeCodeAdapterLayer),
      Layer.provide(geminiAdapterLayer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
  }).pipe(Layer.unwrap);
}

export function makeServerRuntimeServicesLayer() {
  const gitCoreLayer = GitCoreLive.pipe(Layer.provideMerge(GitServiceLive));
  const textGenerationLayer = CodexTextGenerationLive;

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  );

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(CheckpointStoreLive),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    orchestrationLayer,
    OrchestrationProjectionSnapshotQueryLive,
    CheckpointStoreLive,
    checkpointDiffQueryLayer,
  );
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(textGenerationLayer),
    Layer.provideMerge(ThreadExternalLinkRepositoryLive),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
  );

  const terminalLayer = TerminalManagerLive.pipe(
    Layer.provide(
      typeof Bun !== "undefined" && process.platform !== "win32"
        ? BunPtyAdapterLive
        : NodePtyAdapterLive,
    ),
  );

  const forgeCliResolverLayer = ForgeCliResolverLive.pipe(Layer.provideMerge(gitCoreLayer));

  const gitManagerLayer = GitManagerLive.pipe(
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(forgeCliResolverLayer),
    Layer.provideMerge(textGenerationLayer),
  );

  const workspaceRepoScannerLayer = WorkspaceRepoScannerLive.pipe(
    Layer.provideMerge(gitManagerLayer),
  );

  const notificationLayer = WebPushServiceLive.pipe(
    Layer.provideMerge(ProjectionPushSubscriptionRepositoryLive),
  );

  // History import layers
  // HistoryMaterializerLive needs OrchestrationEngineService (from orchestrationLayer)
  // and ThreadExternalLinkRepository (from ThreadExternalLinkRepositoryLive)
  const historyMaterializerLayer = HistoryMaterializerLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(ThreadExternalLinkRepositoryLive),
  );
  // HistoryImportServiceLive needs CodexHistoryScannerService, CodexRolloutParserService,
  // ClaudeCodeHistoryScannerService, ClaudeCodeSessionParserService,
  // HistoryMaterializerService, HistoryImportCatalogRepository
  // Both scanner layers need HistoryImportCatalogRepository (via HistoryImportCatalogRepositoryLive)
  const historyImportLayers = HistoryImportServiceLive.pipe(
    Layer.provideMerge(CodexHistoryScannerLive),
    Layer.provideMerge(CodexRolloutParserLive),
    Layer.provideMerge(ClaudeCodeHistoryScannerLive),
    Layer.provideMerge(ClaudeCodeSessionParserLive),
    Layer.provideMerge(historyMaterializerLayer),
    Layer.provideMerge(HistoryImportCatalogRepositoryLive),
  );

  return Layer.mergeAll(
    orchestrationReactorLayer,
    gitCoreLayer,
    gitManagerLayer,
    workspaceRepoScannerLayer,
    terminalLayer,
    KeybindingsLive,
    ProjectionNotificationRepositoryLive,
    ProjectionDraftRepositoryLive,
    ProjectionUsageAggregateRepositoryLive,
    notificationLayer,
    historyImportLayers,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}
