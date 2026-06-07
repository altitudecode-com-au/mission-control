import { NextResponse } from "next/server";
import { getOctokit, GITHUB_ORG } from "@/lib/github-client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "repo required" }, { status: 400 });

  try {
    const octokit = await getOctokit();
    const { data } = await octokit.issues.listForRepo({
      owner: GITHUB_ORG,
      repo,
      state: "open",
      per_page: 50,
    });

    const issues = data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        id:         i.id,
        number:     i.number,
        title:      i.title,
        html_url:   i.html_url,
        state:      i.state,
        labels:     i.labels.map((l) => (typeof l === "string" ? l : l.name)),
        created_at: i.created_at,
        updated_at: i.updated_at,
        assignee:   i.assignee?.login ?? null,
      }));

    return NextResponse.json(issues);
  } catch (err) {
    console.error("GitHub issues error", err);
    return NextResponse.json({ error: "Failed to fetch issues" }, { status: 500 });
  }
}