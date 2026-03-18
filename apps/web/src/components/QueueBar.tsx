import { useCallback, useRef, useState } from "react";
import type { ThreadId } from "@xbetools/contracts";
import { ArrowUpIcon, PencilIcon, XIcon, Trash2Icon, CheckIcon } from "lucide-react";
import { useMessageQueueStore, useThreadQueue } from "~/messageQueueStore";

interface QueueBarProps {
  threadId: ThreadId;
  onPromote: (messageId: string) => void;
}

export function QueueBar({ threadId, onPromote }: QueueBarProps) {
  const queue = useThreadQueue(threadId);
  const removeQueuedMessage = useMessageQueueStore((s) => s.removeQueuedMessage);
  const updateQueuedMessage = useMessageQueueStore((s) => s.updateQueuedMessage);
  const clearQueue = useMessageQueueStore((s) => s.clearQueue);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onStartEdit = useCallback(
    (id: string, text: string) => {
      setEditingId(id);
      setEditText(text);
      requestAnimationFrame(() => editInputRef.current?.focus());
    },
    [],
  );

  const onSaveEdit = useCallback(() => {
    if (editingId && editText.trim()) {
      updateQueuedMessage(threadId, editingId, editText.trim());
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText, threadId, updateQueuedMessage]);

  const onCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  if (queue.length === 0) return null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl">
      <div className="rounded-t-xl border border-b-0 border-border/60 bg-muted/30 px-3 py-2">
        {/* Header */}
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            Queue ({queue.length})
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => clearQueue(threadId)}
          >
            <Trash2Icon className="size-3" />
            Clear all
          </button>
        </div>

        {/* Chips row */}
        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin"
        >
          {queue.map((msg, index) => (
            <div
              key={msg.id}
              className="group/chip flex min-w-0 shrink-0 items-center gap-1 rounded-lg border border-border/50 bg-background/80 px-2 py-1 transition-colors hover:border-border"
            >
              {/* Index */}
              <span className="shrink-0 text-[10px] font-medium text-muted-foreground/60">
                {index + 1}
              </span>

              {editingId === msg.id ? (
                /* Inline edit */
                <div className="flex items-center gap-1">
                  <input
                    ref={editInputRef}
                    className="w-32 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-ring/50 sm:w-48"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onSaveEdit();
                      }
                      if (e.key === "Escape") onCancelEdit();
                    }}
                  />
                  <button
                    type="button"
                    className="rounded p-0.5 text-emerald-500 transition-colors hover:bg-emerald-500/10"
                    onClick={onSaveEdit}
                    aria-label="Save edit"
                  >
                    <CheckIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted"
                    onClick={onCancelEdit}
                    aria-label="Cancel edit"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ) : (
                <>
                  {/* Text preview */}
                  <span className="max-w-[140px] truncate text-[11px] text-foreground/80 sm:max-w-[200px]">
                    {msg.text || "(image only)"}
                  </span>

                  {/* Action buttons — visible on hover */}
                  <div className="ml-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/chip:opacity-100">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => onStartEdit(msg.id, msg.text)}
                      aria-label="Edit message"
                    >
                      <PencilIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeQueuedMessage(threadId, msg.id)}
                      aria-label="Remove from queue"
                    >
                      <XIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      onClick={() => onPromote(msg.id)}
                      aria-label="Run now (interrupt current and send this)"
                    >
                      <ArrowUpIcon className="size-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
