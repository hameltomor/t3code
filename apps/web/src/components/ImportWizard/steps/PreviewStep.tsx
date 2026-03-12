import { useState } from "react";
import { AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, LoaderIcon } from "lucide-react";
import type { HistoryImportConversationPreview } from "@xbetools/contracts";
import { Badge } from "~/components/ui/badge";

interface PreviewStepProps {
  preview: HistoryImportConversationPreview | null;
  isLoading: boolean;
  error: string | null;
}

const LINK_MODE_LABELS: Record<string, string> = {
  "native-resume": "Resumable",
  "transcript-replay": "Replay",
  "snapshot-only": "Snapshot",
};

export function PreviewStep({ preview, isLoading, error }: PreviewStepProps) {
  const [activitiesExpanded, setActivitiesExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <LoaderIcon className="size-4 animate-spin" />
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-destructive">
        <AlertTriangleIcon className="size-4 shrink-0" />
        {error}
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Select a session to preview
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium">{preview.title}</span>
        <Badge variant="outline" size="sm">
          {preview.providerName}
        </Badge>
      </div>

      {preview.isTruncated && (
        <p className="text-xs text-muted-foreground">
          Showing {preview.messages.length} of {preview.totalMessageCount} messages (truncated)
        </p>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div className="space-y-2">
          {preview.warnings.map((warning) => (
            <div
              key={warning}
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700 dark:bg-amber-950/30"
            >
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      {preview.messages.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {preview.messages.map((message) => (
            <div
              key={`${message.role}-${message.createdAt}`}
              className={`border-b px-3 py-2 last:border-b-0 ${
                message.role === "user" ? "bg-muted/30" : "bg-background"
              }`}
            >
              <p className="mb-0.5 text-xs font-semibold">
                {message.role === "user" ? "User" : "Assistant"}
              </p>
              <p className="line-clamp-4 text-xs text-muted-foreground">{message.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Activities */}
      {preview.activities.length > 0 && (
        <div>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-1.5 text-sm font-medium"
            onClick={() => setActivitiesExpanded((prev) => !prev)}
          >
            {activitiesExpanded ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
            Activities ({preview.activities.length})
          </button>
          {activitiesExpanded && (
            <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
              {preview.activities.map((activity) => (
                <div key={`${activity.kind}-${activity.summary}`} className="flex items-start gap-2 text-xs">
                  <Badge variant="secondary" size="sm">
                    {activity.kind}
                  </Badge>
                  <span className="text-muted-foreground">{activity.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats footer */}
      <div className="flex items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
        <span>{preview.totalMessageCount} messages</span>
        <span>{preview.totalActivityCount} activities</span>
        <Badge variant="info" size="sm">
          {LINK_MODE_LABELS[preview.linkMode] ?? preview.linkMode}
        </Badge>
      </div>
    </div>
  );
}
