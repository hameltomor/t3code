import { useState } from "react";
import {
  ChevronDownIcon,
  Link2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";

import type { ThreadExternalLink } from "@xbetools/contracts";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "~/lib/utils";

// ── Status Mapping ──────────────────────────────────────────────────

type BadgeVariant = "success" | "destructive" | "warning" | "outline" | "error" | "info";

function getStatusBadge(status: string): { variant: BadgeVariant; label: string } {
  switch (status) {
    case "valid":
      return { variant: "success", label: "Valid" };
    case "missing":
      return { variant: "error", label: "Source Missing" };
    case "stale":
      return { variant: "warning", label: "Source Changed" };
    case "invalid":
      return { variant: "error", label: "Invalid" };
    case "unknown":
      return { variant: "outline", label: "Not Validated" };
    case "importing":
      return { variant: "warning", label: "Partial Import" };
    default:
      return { variant: "outline", label: status };
  }
}

// ── Provider Label ──────────────────────────────────────────────────

function getProviderLabel(providerName: string): string {
  switch (providerName) {
    case "codex":
      return "Codex";
    case "claudeCode":
      return "Claude Code";
    default:
      return providerName;
  }
}

// ── Date Formatting ─────────────────────────────────────────────────

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "Never";
  try {
    return dateFormatter.format(new Date(isoDate));
  } catch {
    return isoDate;
  }
}

// ── Component ───────────────────────────────────────────────────────

interface ProvenanceCardProps {
  externalLink: ThreadExternalLink;
  onValidate: () => void;
  isValidating: boolean;
  onContinueInProvider?: (() => void) | undefined;
}

export function ProvenanceCard({
  externalLink,
  onValidate,
  isValidating,
  onContinueInProvider,
}: ProvenanceCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const providerLabel = getProviderLabel(externalLink.providerName);
  const { variant: badgeVariant, label: badgeLabel } = getStatusBadge(
    externalLink.validationStatus,
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-b border-border bg-muted/30">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
          <Link2Icon className="size-3 shrink-0" />
          <span className="truncate">Imported from {providerLabel}</span>
          <Badge variant={badgeVariant} size="sm">
            {badgeLabel}
          </Badge>
          <ChevronDownIcon
            className={cn(
              "ml-auto size-3 shrink-0 transition-transform duration-200",
              isOpen && "rotate-180",
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-1 px-4 py-2 text-xs text-muted-foreground">
            <MetadataRow label="Provider" value={providerLabel} />
            <MetadataRow label="Original CWD" value={externalLink.originalCwd} mono />
            <MetadataRow label="Imported" value={formatDate(externalLink.importedAt)} />
            <MetadataRow label="Link Mode" value={externalLink.linkMode} />
            <MetadataRow label="Source" value={externalLink.sourcePath} mono />
            <MetadataRow label="Last Validated" value={formatDate(externalLink.lastValidatedAt)} />
          </div>

          <div className="flex items-center gap-2 border-t border-border/50 px-4 py-2">
            <Button
              size="xs"
              variant="outline"
              onClick={onValidate}
              disabled={isValidating}
            >
              <RefreshCwIcon className={cn("size-3", isValidating && "animate-spin")} />
              {isValidating ? "Validating..." : "Validate Link"}
            </Button>
            {externalLink.linkMode === "native-resume" && onContinueInProvider && (
              <Button
                size="xs"
                variant="default"
                onClick={onContinueInProvider}
              >
                <PlayIcon className="size-3" />
                Continue in {providerLabel}
              </Button>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Metadata Row ────────────────────────────────────────────────────

function MetadataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-muted-foreground/70">{label}:</span>
      <span className={cn("min-w-0 truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}
