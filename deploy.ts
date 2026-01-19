import { serve } from "bun";
import config from "./deploy.config.json";

type Repo = {
  secret: string;
  path: string;
  cmd: string;
};

serve({
  port: 6061,
  fetch(req) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const id = new URL(req.url).pathname.slice(1);
    const repo = (config.repos as Record<string, Repo>)[id];
    if (!repo) return new Response("unknown repo", { status: 404 });

    if (req.headers.get("x-hook-secret") !== repo.secret) return new Response("forbidden", { status: 403 });

    const p = Bun.spawnSync({
      cmd: ["sh", "-c", `cd ${repo.path} && ${repo.cmd}`],
      stdout: "inherit",
      stderr: "inherit"
    });

    return p.exitCode === 0 ? new Response("ok") : new Response("deploy failed", { status: 500 });
  }
});
