# PITCHUP — Production Deploy Runbook

> Step-by-step to get `pitchup.online` live on a single VPS. Topology + the *why*
> live in [ADR-0006](./adr/0006-deploy-topology.md); this is the *how*.
> Most steps here are **owner actions** (SSH, DNS, secrets, OAuth) — the agent
> can't drive them.

## Topology

```
Browser ──HTTPS──▶ Cloudflare (proxied, Full(strict))
                        │  HTTPS (Origin cert)
                        ▼
                   Caddy  :80/:443  ──reverse_proxy──▶  app :3000  (Next standalone)
                        (one VPS, docker compose)            │
                                                             ▼
                                                        db :5432  (Postgres 16 + volume)
   GitHub Actions ──build──▶ GHCR ──pull──▶ VPS               ▲
   host crontab ──run──▶ cron image ──────────────────────────┘ (4 jobs + pg_dump)
```

## Prerequisites

- A VPS (Debian/Ubuntu assumed) with root/sudo and a public IP.
- The `pitchup.online` domain on a Cloudflare account.
- A Google Cloud OAuth client (from Layer 1).
- This repo on GitHub (for Actions + GHCR).

---

## 1. One-time VPS provisioning

```bash
# As root on the VPS.
# 1a. Install Docker Engine + compose plugin (official convenience script).
curl -fsSL https://get.docker.com | sh

# 1b. A non-root deploy user in the docker group.
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# 1c. Firewall: SSH + HTTP + HTTPS only. (Postgres/app ports are never published.)
apt-get update && apt-get install -y ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
# Hardening (optional): restrict 80/443 to Cloudflare IP ranges
#   (https://www.cloudflare.com/ips/) so the origin can't be hit directly.

# 1d. Clone the repo to /opt/pitchup (owned by deploy).
mkdir -p /opt/pitchup && chown deploy:deploy /opt/pitchup
sudo -u deploy git clone https://github.com/<owner>/pitchup.git /opt/pitchup
```

## 2. Environment file on the VPS

```bash
sudo -u deploy bash
cd /opt/pitchup
cp .env.production.example .env
# Edit .env — fill EVERY blank. Generate secrets:
#   openssl rand -base64 32   # AUTH_SECRET (>=32 chars)
#   openssl rand -base64 32   # POSTGRES_PASSWORD
# Set:
#   COMPOSE_PROFILES=prod
#   APP_IMAGE=ghcr.io/<owner-lowercase>/pitchup:latest
#   CRON_IMAGE=ghcr.io/<owner-lowercase>/pitchup-cron:latest
#   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET   (from Google Cloud)
#   NEXT_PUBLIC_APP_URL=https://pitchup.online   AUTH_URL=https://pitchup.online
#   EMAIL_TRANSPORT=resend + RESEND_API_KEY + RESEND_FROM   (optional)
#   ABLY_API_KEY + NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY            (optional)
```

`.env` is git-ignored — secrets stay on the box.

## 3. Cloudflare — DNS + TLS

1. **DNS:** add an `A` record `pitchup.online` → VPS IP, **Proxied** (orange cloud).
   (Add `www` → CNAME `pitchup.online` proxied if you want www.)
2. **SSL/TLS → Overview:** set mode to **Full (strict)**.
3. **SSL/TLS → Origin Server → Create Certificate** (default RSA, 15 years).
   Save the two PEM blocks ON THE VPS as:
   ```
   /opt/pitchup/caddy/certs/pitchup.online.pem   # the certificate
   /opt/pitchup/caddy/certs/pitchup.online.key   # the private key
   ```
   These are git-ignored. `chmod 600 caddy/certs/pitchup.online.key`.

> Alternative (auto-renewing, no manual cert): Cloudflare **DNS-01** with a custom
> Caddy build (`xcaddy build --with github.com/caddy-dns/cloudflare`) + a scoped
> CF API token. More moving parts; only worth it if you drop the proxy. Not the
> default — see ADR-0006 §5.

## 4. Google OAuth redirect

In the Google Cloud OAuth client, add:
- **Authorized redirect URI:** `https://pitchup.online/api/auth/callback/google`
- **Authorized JavaScript origin:** `https://pitchup.online`

(`AUTH_URL` + `trustHost: true` make Auth.js build callbacks against this host.)

## 5. GitHub Actions — secrets, variables, GHCR

**Settings → Secrets and variables → Actions:**

| Kind | Name | Value |
|---|---|---|
| Variable | `NEXT_PUBLIC_APP_URL` | `https://pitchup.online` |
| Variable | `DEPLOY_ENABLED` | `true` (enables the SSH deploy job) |
| Secret | `NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY` | Ably subscribe-only key (or leave unset) |
| Secret | `DEPLOY_SSH_HOST` | VPS IP/host |
| Secret | `DEPLOY_SSH_USER` | `deploy` |
| Secret | `DEPLOY_SSH_KEY` | the **private** deploy key (below) |

```bash
# On your laptop: a dedicated deploy keypair.
ssh-keygen -t ed25519 -f ./pitchup_deploy -N "" -C "pitchup-deploy"
# Public half → the VPS deploy user:
ssh-copy-id -i ./pitchup_deploy.pub deploy@<VPS_IP>
# Private half (contents of ./pitchup_deploy) → the DEPLOY_SSH_KEY secret.
```

**GHCR pull access from the VPS** — pick one:
- **Make the packages public:** GitHub → your profile → Packages → `pitchup` and
  `pitchup-cron` → Package settings → Change visibility → Public. The VPS then
  pulls with no auth. (Simplest.)
- **Keep private:** on the VPS, `docker login ghcr.io -u <user>` with a PAT
  scoped `read:packages` (stored in `~/.docker/config.json`).

## 6. Database — Neon → VPS (or clean start)

The app's entrypoint runs `prisma migrate deploy` on first boot, which creates
the schema **and** the seed demo data (seed lives in a migration). So:

- **Clean start (recommended if there are no real prod users yet):** do nothing
  here — the first `up` builds the schema + seed.
- **Carry Neon data:** dump from Neon and restore into the container after the
  schema exists:
  ```bash
  # From a machine that can reach Neon (data only — schema comes from migrate deploy):
  pg_dump --data-only --no-owner --no-privileges \
    "postgresql://USER:PW@NEON_HOST/db?sslmode=require" > neon-data.sql
  # Copy to the VPS, then (AFTER the stack is up and migrated):
  cat neon-data.sql | docker compose exec -T db psql -U pitchup pitchup
  # If the seed rows collide, either start the DB fresh (drop the seed migration's
  # rows first) or dump specific tables. Inspect before importing.
  ```

## 7. First deploy

```bash
cd /opt/pitchup        # as deploy
# Option A — let CI do it: push to main (DEPLOY_ENABLED=true) → Actions builds,
#   pushes to GHCR, SSHes in and runs pull + up -d.
# Option B — manual first bring-up:
docker compose pull            # app + caddy (prod profile)
docker compose pull cron       # cron image
docker compose up -d           # db + app + caddy; app runs migrate deploy
docker compose logs -f app     # watch: "migrate deploy" → server ready
```

## 8. Install the cron schedule + backups

```bash
cd /opt/pitchup
# Edit deploy/crontab.example if your path isn't /opt/pitchup, then:
crontab deploy/crontab.example
crontab -l                     # verify
# Backup dir + log files:
mkdir -p backups
sudo touch /var/log/pitchup-cron.log /var/log/pitchup-backup.log
sudo chown deploy:deploy /var/log/pitchup-*.log
# Dry-run one job + a backup now:
docker compose run --rm cron inbox-ttl
./deploy/backup.sh && ls -lh backups
```

## 9. Smoke checklist

- [ ] `https://pitchup.online` loads (valid padlock — Cloudflare edge cert).
- [ ] `/games` renders matches (seed or migrated).
- [ ] Google sign-in completes and lands on `/welcome` or `/my-matches`.
- [ ] Create a match, join from a second account, chat posts.
- [ ] `docker compose run --rm cron morning-today` exits 0.
- [ ] `./deploy/backup.sh` writes a `backups/pitchup-YYYY-MM-DD.sql.gz`.
- [ ] (If Resend on) an approve/kick sends an email; (if Ably on) chat is instant.

## 10. Operations

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` (or `caddy`) |
| Redeploy | push to main (CI), or `docker compose pull && docker compose up -d` |
| Rollback | set `APP_IMAGE=ghcr.io/<owner>/pitchup:<good-sha>` in `.env`, `up -d` |
| DB shell | `docker compose exec db psql -U pitchup pitchup` |
| Restore | `gunzip -c backups/<file>.sql.gz \| docker compose exec -T db psql -U pitchup pitchup` |
| Manual cron | `docker compose run --rm cron <morning-today\|morning-tomorrow\|auto-reject\|inbox-ttl>` |
| Cert | 15-year Origin cert — effectively no renewal; rotate via Cloudflare if needed |

## Troubleshooting

- **`UntrustedHost` on `/api/auth/*`** → `AUTH_URL` not set or wrong; must equal
  `https://pitchup.online`. (`trustHost: true` is already in `auth-config.ts`.)
- **502 from Caddy** → app not up/healthy; `docker compose logs app`. Often a
  migrate failure (DB unreachable) — check `db` health.
- **TLS handshake errors at the origin** → Cloudflare not in Full(strict), or the
  Origin cert/key paths/permissions are wrong.
- **VPS can't pull image** → packages still private and no `docker login ghcr.io`.
- **Cron silent** → check `CRON_TZ`, `crontab -l`, and `/var/log/pitchup-cron.log`.
