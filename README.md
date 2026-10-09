#  Operations, Reporting & Document Portal

A web portal for field operations teams. Teams submit daily attendance and vehicle logs, admins manage teams and employees, and the system generates PDF reports (including the Form D log) and emails daily performance summaries to management. Documents are stored in Cloudflare R2.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [VPS Deployment (Ubuntu)](#vps-deployment-ubuntu)
- [Daily Email Reports (Cron)](#daily-email-reports-cron)
- [Updates & Redeployment](#updates--redeployment)
- [API Overview](#api-overview)
- [Security Notes](#security-notes)

---

## Features

- **Login for admins and teams** with two roles: admin (all circles) and team (own circle only).
- **Daily attendance:** mark Present/Absent per employee, with a lock option to prevent later edits.
- **Vehicle log book:** vehicle number, route, start/end time and km, load booked, amount collected, DC count, operation mode, and merged-team details.
- **PDF reports:** circle log, attendance, team log, and performance reports (ReportLab).
- **Document Center:** upload and delete shared documents, stored in Cloudflare R2.
- **Admin control:** create teams, register employees, activate or deactivate either.
- **Email reports:** a combined report for Head Office plus one report per circle (JEYPORE, RAYAGADA, BHANJANAGAR, ASKA, BERHAMPUR, CITY), sent daily or on demand.
- **Protected API docs:** Swagger UI at `/docs` behind HTTP Basic auth (admin credentials).

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Gunicorn + Uvicorn workers |
| Database | PostgreSQL via SQLAlchemy (psycopg) |
| Frontend | Vanilla JavaScript, HTML, CSS (served from `static/`) |
| PDF generation | ReportLab |
| File storage | Cloudflare R2 (S3-compatible, via boto3) |
| Email | SMTP (Zoho by default) |
| Proxy | Caddy (container) |
| Containers | Docker & Docker Compose |

## Project Structure

```
/
├── main.py                 # FastAPI app: routes, request models, auth, R2 upload, startup seeding
├── models.py               # SQLAlchemy models (Admin, Team, Employee, Attendance, VehicleLog, AssetFile)
├── database.py             # DB engine, session factory, get_db dependency
├── queries.py              # Query functions that feed the PDF reports
├── reports_pdf.py          # PDF builders (circle log, Form D, team log, performance)
├── mailer.py               # SMTP sender, circle stats, recipient lists
├── cron_daily_reports.py   # Script that emails yesterday's reports (run by cron)
├── testsmpt.py             # Standalone script to test SMTP credentials
├── static/
│   ├── index.html          # Single-page UI (login, attendance, logs, reports, documents, admin)
│   ├── app.js              # Frontend logic and API calls
│   ├── style.css           # Styles
│   └── logo.png            # Logo
├── Dockerfile              # Python 3.11 image, runs Gunicorn on port 8000
├── docker-compose.yml      # aman_web (app) + aman_caddy (proxy on host port 8002)
├── Caddyfile               # Proxy config: listens on :8002, forwards to aman_web:8000
├── requirements.txt        # Python dependencies
└── .gitignore              # Ignores .env, keys, generated PDFs, local DB files
```

| File | Purpose |
|---|---|
| `main.py` | All API endpoints and the app entry point (`main:app`). Creates tables on startup and seeds a default admin. |
| `models.py` | Database schema. Attendance is unique per employee per date; vehicle log is unique per team per date. |
| `database.py` | Reads `DATABASE_URL` and sets up pooled connections. |
| `queries.py` | Aggregation queries used by reports. |
| `reports_pdf.py` | Builds PDFs in memory and returns bytes to the API. |
| `mailer.py` | Builds the daily summary email and sends it over SMTP. Management recipient lists per circle are defined in `MANAGEMENT_EMAILS`. |
| `cron_daily_reports.py` | Entry point for scheduled emails. |
| `testsmpt.py` | Run once after setting SMTP variables to confirm email works. |
| `Caddyfile` | Gzip/zstd, 50 MB upload limit, security headers. |

## Environment Variables

Create `.env` in the project root (never commit it):

```dotenv
# Database (the compose file also sets DATABASE_URL, see Security Notes)
DATABASE_URL=postgresql://USER:PASSWORD@postgres_mydb:5432/mydb

# Cloudflare R2
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY=your_access_key
R2_SECRET_KEY=your_secret_key
R2_BUCKET=aman
R2_PUBLIC_URL=https://your-public-bucket-domain

# SMTP (Zoho defaults shown)
SMTP_HOST=smtp.zoho.in
SMTP_PORT=465
SMTP_USER=your_sender@example.com
SMTP_PASS=your_app_password
SMTP_FROM=your_sender@example.com
```

## Local Development

**Prerequisites:** Python 3.11+, a PostgreSQL database, and R2 credentials (needed only for document upload).

```bash
git clone git@github.com:rashmikanta3/aman.git
cd aman

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # or create .env as shown above
uvicorn main:app --reload --port 8000
```

Open <http://localhost:8000>. Tables are created automatically on first start.

Test email settings:

```bash
python testsmpt.py
```

## VPS Deployment (Ubuntu)

This app runs as two containers: `aman_fastapi_app` (the API) and `aman_proxy` (Caddy on host port **8002**). It connects to an **existing PostgreSQL container** (`postgres_mydb`) over a shared Docker network. Port 8002 is used so it does not collide with another app (Arcova) already using ports 80/443.

### 1. Prerequisites on the server

Docker and Docker Compose installed, and the PostgreSQL container `postgres_mydb` running with a database named `mydb`.

### 2. Create the shared network (once)

The compose file expects an external network named `app_shared_net`:

```bash
docker network create app_shared_net        # skip if it already exists
docker network connect app_shared_net postgres_mydb   # skip if already connected
```

### 3. Open the firewall port

```bash
sudo ufw allow 8002/tcp
```

If your cloud provider has its own firewall or security list (Oracle, AWS, and so on), open TCP 8002 there too.

### 4. Clone the repository

```bash
git git@github.com:rashmikanta3/field-ops-portal.git
cd aman
```

(Use a read-only GitHub deploy key if the repo is private.)

### 5. Configure `.env`

```bash
nano .env      # paste values from the Environment Variables section
chmod 600 .env
```

### 6. Build and start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f aman_web
```

### 7. Verify

```bash
curl -I http://localhost:8002/
```

Then open `http://YOUR_SERVER_IP:8002` in a browser.

### 8. First login

On first start the app creates an `admin` user. Log in, then **change the default password immediately** (see Security Notes).

### Optional: HTTPS on a domain

Port 8002 serves plain HTTP. To use HTTPS, route a domain through the Caddy that already owns 80/443, for example in that Caddyfile:

```caddyfile
aman.yourdomain.com {
    reverse_proxy aman_fastapi_app:8000
}
```

This requires both containers to share a Docker network (`app_shared_net` already does).

## Daily Email Reports (Cron)

`cron_daily_reports.py` emails the previous day's report to Head Office (combined) and to each circle. Schedule it on the host with `crontab -e`, for example every day at 07:00:

```cron
0 7 * * * docker exec aman_fastapi_app python cron_daily_reports.py >> /var/log/aman_cron.log 2>&1
```

Check the server timezone with `timedatectl`, since cron uses it. Reports can also be triggered manually through `POST /api/admin/reports/send-email`.

## Updates & Redeployment

```bash
cd aman
git pull origin main
docker compose up -d --build
```

## API Overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/login` |
| Teams | `GET /api/teams`, `POST /api/admin/teams`, `PUT /api/admin/teams/{id}/toggle-active` |
| Employees | `GET /api/admin/employees/all`, `POST /api/admin/employees`, `PUT /api/admin/employees/{id}/toggle-active` |
| Attendance | `GET /api/attendance/day`, `POST /api/attendance/submit` |
| Vehicle log | `GET /api/vehicle-log/day`, `POST /api/vehicle-log/submit` |
| Reports | `GET /api/reports/download-circle-log-pdf`, `download-attendance-pdf`, `download-team-log-pdf`, `download-performance-pdf` |
| Documents | `GET /api/assets`, `POST /api/admin/assets/upload`, `DELETE /api/admin/assets/{id}` |
| Email | `POST /api/admin/reports/send-email` |
| Docs | `GET /docs` (Basic auth) |

## Security Notes

Known issues to fix before treating this as production-ready:

- **Plaintext passwords:** admin and team passwords are stored and compared as plain text. Hash them (for example with `passlib`/`bcrypt`, already in `requirements.txt`).
- **Default admin:** a default `admin` account is seeded on startup. Change its password right away and remove the hardcoded seed value from `main.py`.
- **Unprotected admin endpoints:** routes under `/api/admin/*` and the report/download routes have no server-side authentication, and `is_admin` is sent by the client. Add token-based auth and enforce roles on the server.
- **Email recipients in code:** management recipient addresses are hardcoded in `mailer.py`. Consider moving them to configuration.
- **Secrets:** never commit `.env`, R2 keys, or SMTP passwords.
