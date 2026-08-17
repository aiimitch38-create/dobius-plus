import * as React from "react";
import { Bot, FolderGit2, RefreshCw, TerminalSquare } from "lucide-react";

import {
  collectionSize,
  loadDobiusWorkstationSnapshot,
  type DobiusWorkstationSnapshot,
} from "@/shared/api/dobiusCommunications";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { SectionHeader } from "@/shared/ui/PageHeader";

type MetricProps = {
  icon: React.ReactNode;
  label: string;
  value: number;
};

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/45 px-3 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

export function DobiusWorkstationSection() {
  const [snapshot, setSnapshot] = React.useState<DobiusWorkstationSnapshot>();
  const [error, setError] = React.useState<string>();
  const [isLoading, setIsLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      setSnapshot(await loadDobiusWorkstationSnapshot());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="space-y-4" data-testid="dobius-workstation-section">
      <SectionHeader
        title="Dobius workstation"
        description="Live agents and execution surfaces connected to this Communications workspace."
      />
      <Card>
        <CardContent className="p-4">
          {error ? (
            <div className="flex items-center justify-between gap-4" role="alert">
              <div>
                <div className="font-medium">Workstation connection failed</div>
                <div className="mt-1 text-sm text-destructive">{error}</div>
              </div>
              <Button onClick={() => void refresh()} size="sm" variant="outline">
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric
                icon={<Bot className="size-4" />}
                label="Dobius agents"
                value={collectionSize(snapshot?.agents, ["agents"])}
              />
              <Metric
                icon={<FolderGit2 className="size-4" />}
                label="Repositories"
                value={collectionSize(snapshot?.repos, ["repos"])}
              />
              <Metric
                icon={<FolderGit2 className="size-4" />}
                label="Worktrees"
                value={collectionSize(snapshot?.worktrees, ["worktrees", "items"])}
              />
              <Metric
                icon={<TerminalSquare className="size-4" />}
                label="Live terminals"
                value={collectionSize(snapshot?.terminals, ["terminals", "items"])}
              />
            </div>
          )}
          {isLoading ? (
            <div className="mt-3 text-xs text-muted-foreground">Reading Dobius runtime…</div>
          ) : null}
          {!isLoading && snapshot && Object.keys(snapshot.errors).length > 0 ? (
            <div className="mt-3 text-xs text-amber-600" role="status">
              Some workstation data is temporarily unavailable: {Object.keys(snapshot.errors).join(", ")}.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
