import { NextResponse } from "next/server";
import { getOctokit, GITHUB_ORG } from "@/lib/github-client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "repo required" }, { status: 400 });

  try {
    const octokit = await getOctokit();
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner: GITHUB_ORG,
      repo,
      per_page: 10,
    });

    const runs = data.workflow_runs.map((r) => ({
      id:           r.id,
      name:         r.name,
      status:       r.status,
      conclusion:   r.conclusion,
      branch:       r.head_branch,
      html_url:     r.html_url,
      created_at:   r.created_at,
      updated_at:   r.updated_at,
    }));

    return NextResponse.json(runs);
  } catch (err) {
    console.error("GitHub actions error", err);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}