import { ChevronRightIcon, FolderIcon, FileIcon, ArrowUpIcon, LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryEntry } from "@xbetools/contracts";
import { readNativeApi } from "~/nativeApi";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogPanel,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

interface FolderPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

/**
 * Split a server-returned absolute path into breadcrumb segments.
 * Handles both POSIX (`/home/user`) and Windows (`C:\Users\user`) paths.
 */
function splitPathSegments(p: string): { root: string; segments: string[] } {
  // Windows drive root: C:\ or C:/
  const winDriveMatch = p.match(/^([A-Za-z]:[/\\])/);
  if (winDriveMatch) {
    const root = winDriveMatch[1]!;
    const rest = p.slice(root.length);
    const segments = rest.split(/[/\\]/).filter(Boolean);
    return { root, segments };
  }

  // POSIX root
  const segments = p.split("/").filter(Boolean);
  return { root: "/", segments };
}

/**
 * Reconstruct an absolute path from root + segment slice.
 * Uses the separator detected from the root (backslash for Windows drives).
 */
function joinSegments(root: string, segments: string[]): string {
  const isWindows = /^[A-Za-z]:[/\\]$/.test(root);
  const sep = isWindows ? "\\" : "/";
  if (segments.length === 0) return root;
  return root + segments.join(sep);
}

export function FolderPickerModal({ isOpen, onClose, onSelect, initialPath }: FolderPickerModalProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? "/");
  const [entries, setEntries] = useState<readonly DirectoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [pathInput, setPathInput] = useState(initialPath ?? "/");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Use a ref so loadDirectory always reads the latest showHidden without
  // needing it in callback deps (avoids stale-closure and effect-race bugs).
  const showHiddenRef = useRef(showHidden);
  showHiddenRef.current = showHidden;

  const loadDirectory = useCallback(async (dirPath: string) => {
    const api = readNativeApi();
    if (!api) return;

    setIsLoading(true);
    setError(null);
    setSelectedEntry(null);

    try {
      const result = await api.dialogs.listDirectory({
        path: dirPath,
        showHidden: showHiddenRef.current,
      });
      setEntries(result.entries);
      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);
      setPathInput(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read directory");
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Reset ALL state and load initial directory when modal opens.
  // No other effect triggers loading — showHidden toggles go through
  // handleToggleHidden which calls loadDirectory directly.
  useEffect(() => {
    if (isOpen) {
      const start = initialPath ?? "/";
      setCurrentPath(start);
      setPathInput(start);
      setParentPath(null);
      setEntries([]);
      setSelectedEntry(null);
      setError(null);
      setShowHidden(false);
      void loadDirectory(start);
    }
  }, [isOpen, initialPath, loadDirectory]);

  const handleToggleHidden = useCallback(
    (checked: boolean) => {
      setShowHidden(checked);
      // Ref is updated synchronously above (showHiddenRef.current = showHidden)
      // but setState is async, so poke the ref directly for the immediate load.
      showHiddenRef.current = checked;
      void loadDirectory(currentPath);
    },
    [currentPath, loadDirectory],
  );

  const handleEntryClick = useCallback((entry: DirectoryEntry) => {
    if (entry.kind === "directory") {
      setSelectedEntry(entry.path);
    }
  }, []);

  const handleEntryDoubleClick = useCallback(
    (entry: DirectoryEntry) => {
      if (entry.kind === "directory") {
        void loadDirectory(entry.path);
      }
    },
    [loadDirectory],
  );

  const handleGoUp = useCallback(() => {
    if (parentPath) {
      void loadDirectory(parentPath);
    }
  }, [parentPath, loadDirectory]);

  const handlePathInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && pathInput.trim()) {
        void loadDirectory(pathInput.trim());
      }
    },
    [pathInput, loadDirectory],
  );

  const handleSelect = useCallback(() => {
    const selectedPath = selectedEntry ?? currentPath;
    onSelect(selectedPath);
    onClose();
  }, [selectedEntry, currentPath, onSelect, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        e.preventDefault();
        handleSelect();
      }
    },
    [isLoading, handleSelect],
  );

  const { root, segments: breadcrumbSegments } = useMemo(
    () => splitPathSegments(currentPath),
    [currentPath],
  );

  const directories = useMemo(() => entries.filter((e) => e.kind === "directory"), [entries]);
  const files = useMemo(() => entries.filter((e) => e.kind === "file"), [entries]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Select project folder</DialogTitle>
        </DialogHeader>

        {/* Path input */}
        <div className="flex items-center gap-2 border-b border-border px-6 pb-3">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleGoUp}
            disabled={!parentPath || isLoading}
            aria-label="Go to parent directory"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
          <input
            className="flex-1 rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground-secondary focus:border-ring focus:outline-none"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handlePathInputKeyDown}
            placeholder="Type a path and press Enter"
          />
        </div>

        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-0.5 overflow-x-auto px-6 py-2 text-xs text-muted-foreground"
          aria-label="Path breadcrumb"
        >
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => void loadDirectory(root)}
          >
            {root}
          </button>
          {breadcrumbSegments.map((segment, i) => {
            const segmentPath = joinSegments(root, breadcrumbSegments.slice(0, i + 1));
            return (
              <span key={segmentPath} className="flex items-center gap-0.5">
                <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/50" />
                <button
                  type="button"
                  className="shrink-0 rounded px-1 py-0.5 transition-colors hover:bg-secondary hover:text-foreground"
                  onClick={() => void loadDirectory(segmentPath)}
                >
                  {segment}
                </button>
              </span>
            );
          })}
        </nav>

        {/* File list */}
        <DialogPanel className="!p-0" scrollFade={false}>
          <div
            ref={listRef}
            className="min-h-[300px] max-h-[400px] overflow-y-auto"
            role="listbox"
            aria-label="Directory entries"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <div className="px-6 py-8 text-center text-sm text-destructive">{error}</div>
            )}

            {!isLoading && !error && entries.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                Empty directory
              </div>
            )}

            {!isLoading && !error && (
              <>
                {directories.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    role="option"
                    aria-selected={selectedEntry === entry.path}
                    className={`flex w-full items-center gap-3 px-6 py-2 text-left text-sm transition-colors hover:bg-secondary ${
                      selectedEntry === entry.path
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground/80"
                    }`}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                  >
                    <FolderIcon className="size-4 shrink-0 text-blue-400" />
                    <span className="min-w-0 truncate">{entry.name}</span>
                  </button>
                ))}
                {files.map((entry) => (
                  <div
                    key={entry.path}
                    role="option"
                    aria-selected={false}
                    aria-disabled
                    className="flex w-full items-center gap-3 px-6 py-2 text-left text-sm text-muted-foreground/60"
                  >
                    <FileIcon className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">{entry.name}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </DialogPanel>

        <DialogFooter>
          <div className="flex flex-1 items-center">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => handleToggleHidden(e.target.checked)}
                className="rounded"
              />
              Show hidden
            </label>
          </div>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={isLoading}>
            {selectedEntry ? "Select folder" : "Select current folder"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
