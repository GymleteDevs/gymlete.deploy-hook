# Gymlete Deploy Hook

Small Bun service that receives GitHub webhooks and runs deploy commands for configured repos.

## How it works
- POST to `/:repoId` (repoId keys come from `deploy.config.json`)
- Verifies `x-hub-signature-256` using the repo secret
- Runs the configured `cmd` for that repo
- GET `/status.json` returns last deploy attempt info

## Run with PM2
```bash
pm2 start ecosystem.config.js
pm2 status
```

## Config
Edit `deploy.config.json` to set:
- `secret`: GitHub webhook secret
- `path`: repo directory on disk
- `cmd`: deploy command to run
