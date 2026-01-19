import { serve } from "bun";
import crypto from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
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
const statusFile = join(import.meta.dir, "status.json");

const indexHtml = readFileSync(join(import.meta.dir, "public/index.html"), "utf8");

function loadStatusSnapshot() {
  if (!existsSync(statusFile)) return;
  try {
    const raw = readFileSync(statusFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, RepoStatus>;
    Object.entries(parsed).forEach(([id, status]) => {
      if (id in repos) statusByRepo.set(id, status);
    });
  } catch {
    // Ignore corrupted status file and start fresh.
  }
}

function persistStatusSnapshot() {
  const snapshot = Object.fromEntries(
    Object.keys(repos).map((id) => [id, statusByRepo.get(id) ?? {}])
  );
  writeFileSync(statusFile, JSON.stringify(snapshot, null, 2));
}

loadStatusSnapshot();
// Ensure added/removed repos are reflected in the persisted snapshot on boot.
persistStatusSnapshot();

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
    persistStatusSnapshot();

    const proc = Bun.spawn({
      cmd: ["sh", "-c", `cd ${repo.path} && ${repo.cmd}`],
      stdout: "inherit",
      stderr: "inherit"
    });

    proc.exited
      .then((exitCode) => {
        const duration = Date.now() - start;
        const next: RepoStatus = {
          ...(statusByRepo.get(repoId) ?? {}),
          lastExitCode: exitCode ?? 1,
          lastDurationMs: duration
        };

        if (exitCode === 0) {
          next.lastSuccess = new Date().toISOString();
        } else {
          next.lastError = "deploy failed";
        }

        statusByRepo.set(repoId, next);
        persistStatusSnapshot();
      })
      .catch(() => {
        const duration = Date.now() - start;
        statusByRepo.set(repoId, {
          ...(statusByRepo.get(repoId) ?? {}),
          lastExitCode: 1,
          lastDurationMs: duration,
          lastError: "deploy failed"
        });
        persistStatusSnapshot();
      });

    return new Response("accepted", { status: 202 });
  }
});
