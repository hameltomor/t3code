import { AlertCircleIcon, CheckCircle2Icon, MessageSquareIcon, ActivityIcon } from "lucide-react";
import type { HistoryImportExecuteResult } from "@xbetools/contracts";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

interface ResultStepProps {
  result: HistoryImportExecuteResult | null;
  error: string | null;
  onNavigateToThread: (threadId: string) => void;
  onClose: () => void;
}

const LINK_MODE_LABELS: Record<string, string> = {
  "native-resume": "Resumable",
  "transcript-replay": "Replay",
  "snapshot-only": "Snapshot",
};

export function ResultStep({ result, error, onNavigateToThread, onClose }: ResultStepProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <AlertCircleIcon className="size-10 text-destructive" />
        <p className="text-center text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No result available
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <CheckCircle2Icon className="size-12 text-success" />
      <h3 className="text-lg font-semibold">Import Complete</h3>

      <div className="w-full max-w-xs space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>{result.messageCount} messages imported</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ActivityIcon className="size-4 shrink-0 text-muted-foreground" />
          <span>{result.activityCount} activities imported</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Link mode:</span>
          <Badge variant="info" size="sm">
            {LINK_MODE_LABELS[result.linkMode] ?? result.linkMode}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Imported at: {new Date(result.importedAt).toLocaleString()}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => onNavigateToThread(result.threadId)}>
          Go to Thread
        </Button>
      </div>
    </div>
  );
}
