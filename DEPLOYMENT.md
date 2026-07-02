# Absenlah — Self-Hosted Deployment (Phase 4)

This document details how to self-host Absenlah using **Docker + Pocketbase + Nginx**, and outlines the roadmap to publish the Android build to the Google Play Store.

> The primary implementation in this repo uses **FastAPI + MongoDB** for the workspace preview. This document translates the same data model, business rules, and endpoints to a Pocketbase deployment, so you can migrate to Pocketbase in production if desired.

---

## 1. Architecture

```
┌─────────────────────────────┐
│  Expo Android APK (Play)    │
└────────────┬────────────────┘
             │ HTTPS
             ▼
┌─────────────────────────────┐
│  Nginx (reverse proxy, TLS) │
└────────────┬────────────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌──────────┐   ┌──────────────┐
│Pocketbase│   │Static assets │
│(SQLite)  │   │(CDN/optional)│
└──────────┘   └──────────────┘
```

- **Pocketbase** = single Go binary that provides auth, database (SQLite), file storage, realtime, and an admin UI.
- **Nginx** = TLS termination + reverse proxy + rate limiting.
- **Docker Compose** orchestrates both.

---

## 2. Database Schema (Pocketbase)

Create these collections in the Pocketbase admin (`http://server:8090/_/`) or via `pb_migrations`.

### 2.1 `users` (auth collection)
Enable **Auth**. Add extra fields:

| Field                  | Type    | Notes                                  |
| ---------------------- | ------- | -------------------------------------- |
| name                   | text    | required                               |
| role                   | select  | admin, supervisor, user                |
| position               | text    | optional                               |
| division               | text    | optional                               |
| warehouse              | relation → warehouses | optional      |
| must_change_password   | bool    | default true for new users             |
| active                 | bool    | default true                           |

Seed the admin manually via Pocketbase admin UI (or CLI):
```
username: administrator
password: admin123
role: admin
must_change_password: true
```

### 2.2 `warehouses`
| Field     | Type   | Notes                     |
| --------- | ------ | ------------------------- |
| name      | text   | required                  |
| address   | text   |                           |
| latitude  | number | required                  |
| longitude | number | required                  |
| radius_m  | number | default 100               |

### 2.3 `config` (single global doc)
Use a single record with `id: "global"`. Fields:
- `shift_start`, `shift_end`, `lateness_start` (text `HH:MM`)
- `on_time_bonus` (number)
- `late_tiers` (json array: `{from_min, to_min, fine, label}`)
- `overtime_tiers` (json array: `{minutes_after, amount}`)
- `overtime_step_min`, `overtime_step_amount`, `late_step_after_tiers_min`, `late_step_after_tiers_amount`, `shift_duration_hours`
- `early_departure_earliest` (text `HH:MM`), `early_departure_monthly_limit` (number)
- `leave_min_hours_before_shift`, `manual_arrival_limit_hours` (number)

### 2.4 `attendance`
`user` (rel), `date` (text YYYY-MM-DD, unique on `(user,date)`), `check_in_at` (date), `check_out_at` (date), `warehouse` (rel), `check_in_lat`, `check_in_lng` (number), `is_late` (bool), `late_minutes` (number), `penalty_amount` (number), `late_tier` (text), `on_time_bonus` (number), `effective_shift_end` (date), `is_early_check_in` (bool), `overtime_minutes` (number), `overtime_amount` (number), `early_departure` (bool), `early_departure_deduction` (number), `manual` (bool), `manual_reason` (text), `approved_by` (rel users).

### 2.5 `leave_requests`
`user` (rel), `user_name` (text), `position` (text), `division` (text), `date` (text YYYY-MM-DD), `reason` (text), `status` (select: pending/approved/cancelled).

### 2.6 `user_stats`
`user` (rel), `month` (text YYYY-MM), `leave_count`, `early_departure_count`, `total_bonus`, `total_penalty`, `total_overtime` (all numbers). Unique on `(user, month)`.

### 2.7 `regulations`
Single record with `content` (long text).

### 2.8 `notifications`
`user` (rel), `division` (text), `message` (text), `read` (bool).

### 2.9 Access Rules (per collection)
- `users`: list/view for authenticated; create/update/delete for `@request.auth.role = "admin"`.
- `warehouses`, `config`, `regulations`: list/view any auth; write admin only.
- `attendance`: list/view own or `@request.auth.role ~ "admin|supervisor"`; create own; update own only if `check_out_at = null`.
- `leave_requests`: list/view where `division = @request.auth.division`; create own; update own.
- `user_stats`, `notifications`: list/view own.

---

## 3. Business Logic in Pocketbase

Pocketbase supports server-side JS hooks (`pb_hooks/*.js`). Implement the rule engine there.

Example `pb_hooks/attendance.pb.js`:
```js
onRecordBeforeCreateRequest((e) => {
  if (e.collection.name !== "attendance") return;
  const rec = e.record;
  const cfg = $app.dao().findFirstRecordByFilter("config", 'id = "global"');
  const wh  = $app.dao().findRecordById("warehouses", rec.get("warehouse"));

  // Haversine
  const dist = haversineMeters(
    rec.get("check_in_lat"), rec.get("check_in_lng"),
    wh.get("latitude"), wh.get("longitude")
  );
  if (dist > wh.get("radius_m")) throw new BadRequestError("Di luar radius");

  // Compute late + bonus + effective shift end (same logic as FastAPI compute_late_fine)
  // ... assign fields to rec ...
}, "attendance");
```
Port the pure functions `compute_late_fine`, `compute_overtime`, `haversine_m` from `server.py` — they're side-effect-free.

---

## 4. Docker Compose

`/opt/absenlah/docker-compose.yml`:
```yaml
version: "3.9"

services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    restart: unless-stopped
    environment:
      - TZ=Asia/Jakarta
    volumes:
      - ./pb_data:/pb/pb_data
      - ./pb_hooks:/pb/pb_hooks
      - ./pb_migrations:/pb/pb_migrations
    expose:
      - "8090"

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    depends_on: [pocketbase]
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
```

Start: `docker compose up -d`. Admin UI: `https://your.domain/_/`.

---

## 5. Nginx (TLS + reverse proxy)

`/opt/absenlah/nginx.conf`:
```nginx
server {
  listen 80;
  server_name absenlah.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name absenlah.example.com;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;

  # Rate-limit auth
  limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/s;

  location /api/ {
    limit_req zone=auth burst=20 nodelay;
    proxy_pass http://pocketbase:8090/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
  }

  location /_/ {  # Pocketbase admin UI
    proxy_pass http://pocketbase:8090/_/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Obtain TLS via Let's Encrypt (`certbot certonly --standalone -d absenlah.example.com`) and mount into `./certs`.

---

## 6. Backups

Cron-schedule a nightly SQLite backup:
```bash
docker exec absenlah-pocketbase-1 sqlite3 /pb/pb_data/data.db ".backup /pb/pb_data/backup-$(date +%F).db"
```

---

## 7. Frontend (Expo) — Point to production

Update `frontend/.env`:
```
EXPO_PUBLIC_BACKEND_URL=https://absenlah.example.com
```
Rebuild.

---

## 8. Google Play Store Roadmap

1. **Prerequisites**
   - Google Play Developer account ($25 one-time)
   - App icon 512×512, feature graphic 1024×500
   - Privacy Policy URL (must document GPS collection)
   - App name, short description (80 chars), long description
2. **App configuration**
   - Set `expo.android.package = "com.absenlah.app"` in `app.json`
   - Set `expo.version` (semantic) and `expo.android.versionCode` (integer)
   - Add required permissions in `app.json` → `expo.android.permissions`:
     `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET`
   - Add `ios.infoPlist.NSLocationWhenInUseUsageDescription` if you plan iOS too
3. **Build the AAB**
   - Use the Emergent **Publish** button (top right) to generate a signed Android App Bundle. This handles keystore, signing, and versioning.
4. **Play Console setup**
   - Create app → choose "App" type
   - Complete Store listing (title, screenshots, feature graphic, description)
   - Fill Content rating questionnaire
   - Fill Data safety form: declare Location (approximate + precise), account info, why they're collected, whether shared, retention
   - Set Target audience (18+ business/HR)
   - Add Privacy Policy URL
5. **Testing tracks**
   - Internal testing → invite HR team via email list
   - Closed testing (Alpha) → gather feedback from 5-10 warehouse workers
   - Open testing (Beta) → optional
   - Production release once stable
6. **Post-launch**
   - Monitor crash reports and ANRs in Play Console → Vitals
   - Respond to reviews within 24h
   - Push versioned updates: bump `versionCode` and re-publish AAB

---

## 9. Migration Checklist from FastAPI/MongoDB → Pocketbase

- [ ] Recreate all 8 collections with the schemas above
- [ ] Port `compute_late_fine`, `compute_overtime`, `haversine_m` to `pb_hooks/*.js`
- [ ] Port geofence + dynamic-shift + early-departure logic to Pocketbase hooks
- [ ] Export Mongo data → JSON → import to Pocketbase (or write a one-off Python script that pulls from Mongo and posts to Pocketbase `/api/collections/*/records`)
- [ ] Update Expo `.env` to point at Pocketbase URL
- [ ] Replace the frontend API client's login/refresh to use Pocketbase's `/api/collections/users/auth-with-password`
