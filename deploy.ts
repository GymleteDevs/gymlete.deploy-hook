import { serve } from "bun";
import config from "./deploy.config.json";

type Repo = {
  secret: string;
  path: string;
  cmd: string;
};

type RepoStatus = {
  lastAttempt?: string;
  lastSuccess?: string;
  lastExitCode?: number;
  lastDurationMs?: number;
  lastError?: string;
};

// In-memory status only; resets on restart.
const statusByRepo = new Map<string, RepoStatus>();

const repos = config.repos as Record<string, Repo>;

function renderStatusPage() {
  const rows = Object.keys(repos)
    .sort()
    .map((id) => {
      const status = statusByRepo.get(id) ?? {};
      return `<tr>
        <td>${id}</td>
        <td>${status.lastAttempt ?? "-"}</td>
        <td>${status.lastSuccess ?? "-"}</td>
        <td>${status.lastExitCode ?? "-"}</td>
        <td>${status.lastDurationMs ?? "-"}</td>
        <td>${status.lastError ?? "-"}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Deploy Status</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; }
      h1 { margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; vertical-align: top; }
      th { background: #f5f5f5; position: sticky; top: 0; }
      td { word-break: break-word; }
    </style>
  </head>
  <body>
    <h1>Deploy Status</h1>
    <table>
      <thead>
        <tr>
          <th>Repo</th>
          <th>Last attempt (UTC)</th>
          <th>Last success (UTC)</th>
          <th>Exit code</th>
          <th>Duration (ms)</th>
          <th>Last error</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </body>
</html>`;
}

serve({
  port: 9061,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/status") {
        return new Response(renderStatusPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/status.json") {
        const snapshot = Object.fromEntries(
          Object.keys(repos).map((id) => [id, statusByRepo.get(id) ?? {}])
        );
        return new Response(JSON.stringify(snapshot, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    }

    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const id = url.pathname.slice(1);
    const repo = repos[id];
    if (!repo) return new Response("unknown repo", { status: 404 });

    if (req.headers.get("x-hook-secret") !== repo.secret) return new Response("forbidden", { status: 403 });

    const start = Date.now();
    const lastAttempt = new Date(start).toISOString();
    statusByRepo.set(id, { ...(statusByRepo.get(id) ?? {}), lastAttempt, lastError: undefined });

    const p = Bun.spawnSync({
      cmd: ["sh", "-c", `cd ${repo.path} && ${repo.cmd}`],
      stdout: "inherit",
      stderr: "inherit"
    });

    const lastDurationMs = Date.now() - start;
    const nextStatus: RepoStatus = {
      ...(statusByRepo.get(id) ?? {}),
      lastExitCode: p.exitCode ?? 1,
      lastDurationMs
    };

    if (p.exitCode === 0) {
      nextStatus.lastSuccess = new Date().toISOString();
    } else {
      nextStatus.lastError = "deploy failed";
    }

    statusByRepo.set(id, nextStatus);
    return p.exitCode === 0 ? new Response("ok") : new Response("deploy failed", { status: 500 });
  }
});
