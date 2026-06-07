import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

let _octokit: Octokit | null = null;

export async function getOctokit(): Promise<Octokit> {
  if (_octokit) return _octokit;

  const appId     = process.env.GITHUB_APP_ID!;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID!;

  const auth = createAppAuth({ appId, privateKey });
  const { token } = await auth({
    type: "installation",
    installationId: Number(installationId),
  });

  _octokit = new Octokit({ auth: token });
  return _octokit;
}

export const GITHUB_ORG = process.env.GITHUB_ORG!;