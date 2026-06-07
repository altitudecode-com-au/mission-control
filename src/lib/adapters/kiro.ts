export interface KiroAdapterConfig {
  apiKey: string;
  baseUrl?: string;
}

export class KiroAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: KiroAdapterConfig) {
    this.apiKey  = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.kiro.aws";
  }

  async dispatchTask(task: {
    id: string;
    title: string;
    body: string;
    repo: string;
    issue_number: number;
    issue_url: string;
  }): Promise<{ kiro_task_id: string }> {
    const res = await fetch(`${this.baseUrl}/v1/tasks`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        title:      task.title,
        description: task.body,
        context: {
          source:       "github-issue",
          repo:         task.repo,
          issue_number: task.issue_number,
          issue_url:    task.issue_url,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Kiro API error: ${res.status} ${await res.text()}`);
    }

    return res.json();
  }

  async getTaskStatus(kiroTaskId: string): Promise<{
    status: "pending" | "in_progress" | "done" | "failed";
    output?: string;
  }> {
    const res = await fetch(`${this.baseUrl}/v1/tasks/${kiroTaskId}`, {
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    });

    if (!res.ok) throw new Error(`Kiro status error: ${res.status}`);
    return res.json();
  }
}