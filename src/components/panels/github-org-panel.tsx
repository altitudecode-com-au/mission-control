"use client";
import { useEffect, useState } from "react";

type Repo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  open_issues: number;
  updated_at: string | null;
};

type WorkflowRun = {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  branch: string | null;
  html_url: string;
};

function statusColour(conclusion: string | null, status: string | null) {
  if (status === "in_progress") return "text-yellow-500";
  if (conclusion === "success") return "text-green-500";
  if (conclusion === "failure") return "text-red-500";
  return "text-gray-400";
}

function statusLabel(conclusion: string | null, status: string | null) {
  if (status === "in_progress") return "Running";
  if (conclusion === "success") return "Passed";
  if (conclusion === "failure") return "Failed";
  return conclusion ?? status ?? "Unknown";
}

export function GitHubOrgPanel() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<Record<string, WorkflowRun[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((data) => setRepos(Array.isArray(data) ? data : []))
      .catch(() => setError("Failed to load repos"))
      .finally(() => setLoading(false));
  }, []);

  async function toggleRepo(repoName: string) {
    if (expanded === repoName) {
      setExpanded(null);
      return;
    }
    setExpanded(repoName);
    if (!runs[repoName]) {
      const [actionsRes] = await Promise.all([
        fetch(`/api/github/actions?repo=${repoName}`).then((r) => r.json()),
      ]);
      setRuns((prev) => ({ ...prev, [repoName]: Array.isArray(actionsRes) ? actionsRes : [] }));
    }
  }

  async function labelAsAgentPickup(repoFullName: string, issueNumber: number) {
    await fetch(`/api/github/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: repoFullName,
        issue_number: issueNumber,
        label: "agent-pickup",
      }),
    });
  }

  if (loading)
    return <div className="p-4 text-sm text-muted-foreground">Loading repos…</div>;
  if (error)
    return <div className="p-4 text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-base font-medium mb-3">GitHub Org</h2>
      {repos.map((repo) => (
        <div key={repo.id} className="border border-border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
            onClick={() => toggleRepo(repo.name)}
          >
            <div>
              <span className="font-medium text-sm">{repo.name}</span>
              {repo.description && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {repo.description}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{repo.open_issues} issues</span>
              <span>{expanded === repo.name ? "▲" : "▼"}</span>
            </div>
          </button>

          {expanded === repo.name && (
            <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Recent Actions runs
                </p>
                {!runs[repo.name] ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : runs[repo.name].length === 0 ? (
                  <p className="text-xs text-muted-foreground">No runs found</p>
                ) : (
                  <div className="space-y-1">
                    {runs[repo.name].slice(0, 5).map((run) => (
                      <a
                        key={run.id}
                        href={run.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs hover:underline"
                      >
                        <span className={statusColour(run.conclusion, run.status)}>
                          ●
                        </span>
                        <span>{run.name ?? "Workflow"}</span>
                        <span className="text-muted-foreground">
                          {statusLabel(run.conclusion, run.status)} on {run.branch}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}