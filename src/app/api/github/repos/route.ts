import { NextResponse } from "next/server";
import { getOctokit, GITHUB_ORG } from "@/lib/github-client";

export async function GET() {
  try {
    const octokit = await getOctokit();
    const { data } = await octokit.repos.listForOrg({
      org: GITHUB_ORG,
      sort: "pushed",
      per_page: 50,
    });

    const repos = data.map((r) => ({
      id:             r.id,
      name:           r.name,
      full_name:      r.full_name,
      html_url:       r.html_url,
      description:    r.description,
      default_branch: r.default_branch,
      open_issues:    r.open_issues_count,
      updated_at:     r.updated_at,
      visibility:     r.visibility,
    }));

    return NextResponse.json(repos);
  } catch (err) {
    console.error("GitHub repos error", err);
    return NextResponse.json({ error: "Failed to fetch repos" }, { status: 500 });
  }
}