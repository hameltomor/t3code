/**
 * MCP (Model Context Protocol) server status contracts.
 *
 * Schemas for querying and managing MCP server status through the
 * provider adapter layer. Only Claude Code sessions expose MCP runtime
 * methods; other providers return empty results gracefully.
 *
 * @module mcp
 */
import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

// ── MCP WS Method Names ─────────────────────────────────────────────

export const MCP_WS_METHODS = {
  getStatus: "provider.mcpStatus",
  toggleServer: "provider.mcpToggle",
  reconnectServer: "provider.mcpReconnect",
} as const;

// ── Value Schemas ────────────────────────────────────────────────────

export const McpServerConnectionStatus = Schema.Union([
  Schema.Literal("connected"),
  Schema.Literal("failed"),
  Schema.Literal("needs-auth"),
  Schema.Literal("pending"),
  Schema.Literal("disabled"),
]);
export type McpServerConnectionStatus = typeof McpServerConnectionStatus.Type;

const McpToolAnnotations = Schema.Struct({
  readOnly: Schema.optional(Schema.Boolean),
  destructive: Schema.optional(Schema.Boolean),
  openWorld: Schema.optional(Schema.Boolean),
});

export const McpTool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  annotations: Schema.optional(McpToolAnnotations),
});
export type McpTool = typeof McpTool.Type;

const McpServerInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
});

export const McpServerStatusItem = Schema.Struct({
  name: Schema.String,
  status: McpServerConnectionStatus,
  scope: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Array(McpTool)),
  serverInfo: Schema.optional(McpServerInfo),
});
export type McpServerStatusItem = typeof McpServerStatusItem.Type;

// ── Input / Result Schemas ───────────────────────────────────────────

export const McpGetStatusInput = Schema.Struct({
  threadId: ThreadId,
});
export type McpGetStatusInput = typeof McpGetStatusInput.Type;

export const McpGetStatusResult = Schema.Struct({
  threadId: ThreadId,
  servers: Schema.Array(McpServerStatusItem),
});
export type McpGetStatusResult = typeof McpGetStatusResult.Type;

export const McpToggleServerInput = Schema.Struct({
  threadId: ThreadId,
  serverName: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
});
export type McpToggleServerInput = typeof McpToggleServerInput.Type;

export const McpReconnectServerInput = Schema.Struct({
  threadId: ThreadId,
  serverName: TrimmedNonEmptyString,
});
export type McpReconnectServerInput = typeof McpReconnectServerInput.Type;
