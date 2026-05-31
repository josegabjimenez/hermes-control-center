# Hermes Control Center

A PWA web app to control your local Hermes Agent installation from a browser.

## Features (functional)

- Secure API with bearer token
- Live Hermes status + profiles
- Kanban board list + stats
- Skills list
- Cron list
- Sessions list
- Safe command runner (allowlisted Hermes commands)
- Hermes chat execution from the web UI
- Mobile responsive + installable PWA

## Architecture

- **Frontend:** React + Vite + PWA
- **Backend:** Node/Express API (`server/index.js`)
- **Hermes integration:** backend runs Hermes CLI directly
- **Deploy:** Docker Compose

## Security model

The web app requires an API token (`HERMES_WEB_TOKEN`).

1. App sends `Authorization: Bearer TOKEN_HERE`
2. Backend validates token
3. Backend executes only approved Hermes commands for `/api/hermes/command`

> Important: change the default token before exposing publicly.

## Project path

`/root/projects/hermes-control-center`

## Run locally (without Docker)

```bash
cd /root/projects/hermes-control-center
npm install
npm run build
PORT=8080 HERMES_WEB_TOKEN=TOKEN_HERE \
HERMES_BIN=/usr/local/lib/hermes-agent/venv/bin/hermes \
HERMES_HOME=/root/.hermes \
npm run start
```

Open: `http://<server-ip>:8080`

## Deploy with Docker Compose

### 1) Edit token in compose file

Edit `docker-compose.yml` and replace:

```yaml
- HERMES_WEB_TOKEN=changeme-strong-token
```

with your own strong token.

### 2) Start services

```bash
cd /root/projects/hermes-control-center
docker compose up -d --build
```

### 3) Open app

`http://<server-ip>:8080`

### 4) Login in app

Paste the same token in the sidebar "API Token" field.

## Notes about Hermes access in Docker

The container mounts:

- `/usr/local/lib/hermes-agent` → `/opt/hermes` (read-only)
- `/root/.hermes` → `/root/.hermes`

and uses:

- `HERMES_BIN=/opt/hermes/venv/bin/hermes`

So the web API controls the Hermes instance installed on your VPS host.

## Next recommended upgrades

- Add HTTPS + domain + Cloudflare Access / Tailscale auth
- Add role-based access and per-action audit logs
- Add websocket streaming for long-running Hermes tasks
- Add visual parsers for Hermes output (cards/charts instead of raw text)
