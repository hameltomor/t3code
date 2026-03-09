import type { ProjectId, WorkspaceRepoSummary } from "@xbetools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";

import { gitWorkspaceReposQueryOptions } from "~/lib/gitReactQuery";
import { useSelectedRepoCwd } from "~/store";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface RepoSwitcherProps {
  projectId: ProjectId;
  workspaceRoot: string;
  onSelectedRepoCwdChange: (repoCwd: string) => void;
}

export default function RepoSwitcher({
  projectId,
  workspaceRoot,
  onSelectedRepoCwdChange,
}: RepoSwitcherProps) {
  const { data } = useQuery(gitWorkspaceReposQueryOptions(workspaceRoot));
  const selectedRepoCwd = useSelectedRepoCwd(projectId);

  const repos = data?.repos ?? [];

  if (repos.length === 0) return null;

  // If only one repo and it IS the workspace root, no need for a switcher
  if (repos.length === 1 && repos[0]!.isRoot) return null;

  const activeRepo = repos.find((repo) => repo.path === selectedRepoCwd) ?? repos[0];
  if (!activeRepo) return null;

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button variant="outline" size="xs" className="max-w-48 gap-1.5">
                  <GitBranchIcon className="size-3 shrink-0" />
                  <span className="truncate">
                    {activeRepo.name}
                  </span>
                  {activeRepo.hasChanges && (
                    <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                  {activeRepo.branch && (
                    <span className="truncate text-muted-foreground">
                      {activeRepo.branch}
                    </span>
                  )}
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">Switch repository</TooltipPopup>
      </Tooltip>
      <MenuPopup sideOffset={4}>
        {repos.map((repo) => (
          <MenuItem
            key={repo.path}
            onClick={() => {
              onSelectedRepoCwdChange(repo.path);
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <RepoStatusDot repo={repo} />
              <span className="min-w-0 truncate font-medium">{repo.name}</span>
              {repo.branch && (
                <span className="shrink-0 text-xs text-muted-foreground">{repo.branch}</span>
              )}
              {repo.path === activeRepo.path && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">selected</span>
              )}
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function RepoStatusDot({ repo }: { repo: WorkspaceRepoSummary }) {
  if (repo.hasChanges) {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-amber-500"
        title="Has uncommitted changes"
      />
    );
  }
  if (repo.aheadCount > 0) {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-blue-500"
        title={`${repo.aheadCount} commit(s) ahead`}
      />
    );
  }
  return (
    <span className="size-2 shrink-0 rounded-full bg-emerald-500" title="Clean" />
  );
}

interface RepoSummaryBadgeProps {
  projectId: ProjectId;
  workspaceRoot: string;
}

export function RepoSummaryBadge({ projectId: _projectId, workspaceRoot }: RepoSummaryBadgeProps) {
  const { data } = useQuery(gitWorkspaceReposQueryOptions(workspaceRoot));
  const repos = data?.repos ?? [];

  if (repos.length === 0) return null;
  // Single repo that is the root: no badge needed (handled by normal git UI)
  if (repos.length === 1 && repos[0]!.isRoot) return null;

  const dirtyCount = repos.filter((repo) => repo.hasChanges).length;

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
      title={`${repos.length} repo${repos.length !== 1 ? "s" : ""}, ${dirtyCount} with changes`}
    >
      <span className="flex items-center gap-0.5">
        {repos.map((repo) => (
          <span
            key={repo.path}
            className={`inline-block size-1.5 rounded-full ${
              repo.hasChanges ? "bg-amber-500" : "bg-emerald-500/60"
            }`}
          />
        ))}
      </span>
    </span>
  );
}
