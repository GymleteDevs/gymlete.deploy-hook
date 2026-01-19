import { serve } from "bun";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import config from "./deploy.config.json";

type Repo = {
  secret: string;
  path: string;
  cmd: string;
  branch?: string;
};

type RepoStatus = {
  lastAttempt?: string;
  lastSuccess?: string;
  lastExitCode?: number;
  lastDurationMs?: number;
  lastError?: string;
};

const repos = config.repos as Record<string, Repo>;
const statusByRepo = new Map<string, RepoStatus>();

const indexHtml = readFileSync(join(import.meta.dir, "public/index.html"), "utf8");

function verifyGitHubSignature(signature: string | null, body: string, secret: string): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");

  return signature === `sha256=${hmac}`;
}

serve({
  port: 9061,

  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(indexHtml, {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }

      if (url.pathname === "/status.json") {
        const snapshot = Object.fromEntries(Object.keys(repos).map((id) => [id, statusByRepo.get(id) ?? {}]));
        return new Response(JSON.stringify(snapshot, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      return new Response("not found", { status: 404 });
    }

    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const repoId = url.pathname.slice(1);
    const repo = repos[repoId];
    if (!repo) return new Response("unknown repo", { status: 404 });

    const rawBody = await req.text();

    const sig = req.headers.get("x-hub-signature-256");
    if (!verifyGitHubSignature(sig, rawBody, repo.secret)) {
      return new Response("bad signature", { status: 403 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const expectedRef = `refs/heads/${repo.branch ?? "main"}`;
    if (payload.ref && payload.ref !== expectedRef) {
      return new Response("ignored branch");
    }

    const start = Date.now();
    statusByRepo.set(repoId, {
      ...(statusByRepo.get(repoId) ?? {}),
      lastAttempt: new Date(start).toISOString(),
      lastError: undefined
    });

    const proc = Bun.spawnSync({
      cmd: ["sh", "-c", `cd ${repo.path} && ${repo.cmd}`],
      stdout: "inherit",
      stderr: "inherit"
    });

    const duration = Date.now() - start;
    const next: RepoStatus = {
      ...(statusByRepo.get(repoId) ?? {}),
      lastExitCode: proc.exitCode ?? 1,
      lastDurationMs: duration
    };

    if (proc.exitCode === 0) {
      next.lastSuccess = new Date().toISOString();
    } else {
      next.lastError = "deploy failed";
    }

    statusByRepo.set(repoId, next);

    return proc.exitCode === 0 ? new Response("ok") : new Response("deploy failed", { status: 500 });
  }
});
