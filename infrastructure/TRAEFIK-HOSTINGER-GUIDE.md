# Deploying MES360° on a Hostinger VPS with Traefik (Docker Manager)

> دليل نشر المشروع على VPS من Hostinger باستخدام Traefik المثبّت افتراضيًا في Docker Manager.
> الملف الجاهز للنشر: [`docker-compose.hostinger.yml`](../docker-compose.hostinger.yml)

---

## 1. What is Traefik and why we need it / ما هو Traefik ولماذا نحتاجه

Hostinger Docker Manager runs **each Docker Compose project in isolation**. Only **one**
container can bind host port **80/443** at a time — so if every project shipped its own
nginx on :80, they would collide.

**Traefik** is a reverse proxy that:
- is the **single** thing listening on ports **80 and 443** on the VPS,
- reads **Docker labels** on your containers to learn *which domain → which container*,
- automatically issues and renews **Let's Encrypt SSL** certificates (HTTPS),
- creates a **shared network** (`traefik-proxy`) that any project can join.

> بالعربية: Traefik هو "موزّع الطلبات" الوحيد الذي يفتح المنفذين 80 و443. يقرأ "labels"
> من حاوياتك ليعرف أي دومين يذهب لأي حاوية، ويصدر شهادة HTTPS تلقائيًا. هكذا تستطيع تشغيل
> عدة مشاريع على نفس المنفذ بدون تعارض.

### Benefits for MES360° / الفوائد
| Benefit | الشرح |
|---|---|
| **No port conflicts** | لا حاجة لفتح 80/443 في مشروعنا — Traefik يملكها. يمكن تشغيل مشاريع أخرى بجانبنا. |
| **Free auto‑HTTPS** | شهادة Let's Encrypt تلقائية + تجديد تلقائي. لا مزيد من `:8080` ولا HTTP. |
| **We can delete our nginx** | Traefik يحل محل حاوية nginx الخاصة بنا → حاوية أقل، إعداد أبسط. |
| **Same‑origin, one domain** | الواجهة و API على نفس الدومين (`/` و `/api`) → لا مشاكل CORS. |
| **Zero‑downtime updates** | عند تحديث الصورة، Traefik يكتشف الحاوية الجديدة تلقائيًا بدون إعادة تشغيله. |

---

## 2. How our app maps onto Traefik / كيف يُوجَّه تطبيقنا

Everything is served from **one domain** (e.g. `mes360.industry360.sa`), same‑origin:

```
https://APP_DOMAIN/             ──►  web  (Next.js standalone, internal port 4000)
https://APP_DOMAIN/api/...      ──►  api  (NestJS,  internal port 3001, prefix /api/v1)
https://APP_DOMAIN/socket.io/   ──►  api  (WebSocket / live updates)
```

Why this works without rebuilding the frontend:
- The browser API client (`apps/web/src/services/api.client.ts`) already uses a
  **same‑origin relative path** (`/api/v1/...`) when running in the browser.
- So Traefik only needs to send `/api` and `/socket.io` to the **api** container and
  everything else to the **web** container. The `api` router gets a **higher priority**
  so it wins for those paths.

> مهم: لا تحتاج إعادة بناء صورة الـ web، لأن المتصفح يستخدم مسارًا نسبيًا على نفس الدومين.

---

## 3. What changed vs `docker-compose.prod.yml` / ما الذي تغيّر

The new file [`docker-compose.hostinger.yml`](../docker-compose.hostinger.yml) is the
production compose **with these edits**:

1. **Removed the `nginx` service entirely** — Traefik replaces it. (No more `ports: 80/443`.)
2. **Added the external `traefik-proxy` network** at the bottom:
   ```yaml
   networks:
     mes-network:
       driver: bridge
     traefik-proxy:
       external: true        # join the network Traefik already created
   ```
3. **`api` and `web` now join BOTH networks** (`mes-network` to reach the DBs, `traefik-proxy`
   so Traefik can reach them).
4. **Added Traefik labels** to `api` and `web` (see below).
5. **`web` sets `PORT: "4000"`** (Next standalone honours it) and the label points at `4000`.
6. **`CORS_ORIGINS` / `NEXT_PUBLIC_*`** now point at `https://${APP_DOMAIN}`.

### The labels (the heart of it) / الـ labels الأساسية

**api** service:
```yaml
labels:
  - traefik.enable=true
  - traefik.docker.network=traefik-proxy
  - traefik.http.routers.mes-api.rule=Host(`${APP_DOMAIN}`) && (PathPrefix(`/api`) || PathPrefix(`/socket.io`))
  - traefik.http.routers.mes-api.entrypoints=websecure
  - traefik.http.routers.mes-api.tls.certresolver=letsencrypt
  - traefik.http.routers.mes-api.priority=100          # wins over web for /api & /socket.io
  - traefik.http.services.mes-api.loadbalancer.server.port=3001
```

**web** service:
```yaml
labels:
  - traefik.enable=true
  - traefik.docker.network=traefik-proxy
  - traefik.http.routers.mes-web.rule=Host(`${APP_DOMAIN}`)
  - traefik.http.routers.mes-web.entrypoints=websecure
  - traefik.http.routers.mes-web.tls.certresolver=letsencrypt
  - traefik.http.routers.mes-web.priority=1            # catch‑all, lowest priority
  - traefik.http.services.mes-web.loadbalancer.server.port=4000
  # optional http->https redirect (skip if Traefik already does it globally)
  - traefik.http.routers.mes-web-http.rule=Host(`${APP_DOMAIN}`)
  - traefik.http.routers.mes-web-http.entrypoints=web
  - traefik.http.routers.mes-web-http.middlewares=mes-https-redirect
  - traefik.http.middlewares.mes-https-redirect.redirectscheme.scheme=https
```

> ⚠️ **Names to verify against YOUR Traefik template** (قد تختلف حسب قالب Hostinger):
> - the network name `traefik-proxy`,
> - the entrypoint names `web` (80) / `websecure` (443),
> - the cert resolver name `letsencrypt`.
> See step 5 to confirm them.

---

## 4. Deploy steps / خطوات النشر

### Step 0 — DNS
Create an **A record**: `APP_DOMAIN` → your VPS public IP (e.g. `mes360.industry360.sa → 109.176.199.133`).
Wait for it to resolve (`ping mes360.industry360.sa`).

### Step 1 — Deploy the Traefik template once
In **Docker Manager → Project catalog → Traefik**, deploy it. This creates the
`traefik-proxy` network and starts Traefik on 80/443. (Do this only once for the whole VPS.)

### Step 2 — Get the code on the VPS
```bash
cd /opt
git clone <your-repo-url> mes360      # or: cd /opt/mes360 && git pull
cd /opt/mes360
```

### Step 3 — Create the env file from the template
A ready template lives in the repo: [`.env.hostinger.example`](../.env.hostinger.example).
Copy it to the **real** file (which is git‑ignored so secrets never get committed) and fill it:
```bash
cd /opt/mes360
cp .env.hostinger.example .env.hostinger
nano .env.hostinger          # set APP_DOMAIN + replace every CHANGE_ME value
```
Generate strong secrets fast:
```bash
openssl rand -base64 36      # run once per secret (DB/Redis/Influx/JWT/MinIO…)
```

### Step 4 — Bring it up
```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d
```
Traefik auto‑detects the labels, requests the SSL cert, and starts routing.
Open **https://APP_DOMAIN** — no port, valid HTTPS. 🎉

### Step 5 — Verify the Traefik names (if it doesn't route)
```bash
docker network ls | grep -i traefik          # confirm the network name
docker inspect <traefik-container> | grep -iE "entryPoints|certresolver"
docker logs <traefik-container> --tail 100   # cert / routing errors show here
```
If the network is **not** called `traefik-proxy`, replace every `traefik-proxy` in
`docker-compose.hostinger.yml` with the real name, then `up -d` again.

---

## 5. Updating the app later / تحديث التطبيق لاحقًا

Because the images are pre‑built (no hot reload):

```bash
cd /opt/mes360
git pull                                              # if compose/labels changed
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger pull web api
docker compose -f docker-compose.hostinger.yml --env-file .env.hostinger up -d --no-deps web api
```
Traefik picks up the recreated containers automatically — no Traefik restart needed.

> If you build images **on the VPS** instead of pulling, build them first, then the same
> `up -d --no-deps web api`.

---

## 6. Troubleshooting / حل المشكلات

| Symptom | Cause / Fix |
|---|---|
| **404 from Traefik** | Container not on `traefik-proxy`, or `traefik.docker.network` label wrong, or the network name differs. → `docker network ls`, fix the name. |
| **`/api` calls hit the web app (Next 404)** | The `mes-api` router priority is not higher than `mes-web`. Keep `priority=100` on api, `priority=1` on web. |
| **SSL not issued / cert error** | DNS A record not pointing to the VPS yet, or cert resolver name ≠ `letsencrypt`. Check `docker logs <traefik>`. Let's Encrypt also rate‑limits — wait, don't loop `up -d`. |
| **WebSocket / live data dead** | Ensure the api rule includes `PathPrefix(`/socket.io`)`. Traefik passes WS upgrades through automatically. |
| **Still seeing `:8080`** | That was the old nginx. Stop the old stack: `docker compose -f docker-compose.prod-local.yml down` (or `-f docker-compose.prod.yml down`) before/after switching. |
| **Two projects, same domain** | Each project needs a **unique** `Host(...)` (different domain/subdomain). Two routers can't own the same host+path. |

---

## 7. Quick reference / مرجع سريع

| Thing | Value |
|---|---|
| Compose file | `docker-compose.hostinger.yml` |
| Env template / real file | `.env.hostinger.example` → copy to `.env.hostinger` (git‑ignored) |
| Domain var | `APP_DOMAIN` (in `.env.hostinger`) |
| Web internal port | `4000` (set via `PORT`) |
| API internal port | `3001`, prefix `/api/v1` |
| Shared network | `traefik-proxy` (external, from Traefik template) |
| Entrypoints | `web` (80) → redirect, `websecure` (443) |
| Cert resolver | `letsencrypt` |
| Removed | the `nginx` service (Traefik replaces it) |
