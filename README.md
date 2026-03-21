# Quiet Isles

Discover the UK's most peaceful and beautiful landscapes. A progressive web app that helps you find tranquil nature spots — AONBs, national parks, nature reserves, hidden beaches, ancient woodlands, and more.

## Features

- **Explore** — Browse categorised UK landscape destinations sourced from OpenStreetMap
- **Personalised Suggestions** — Pick your interests and get tailored "For You" recommendations
- **Surprise Me** — Get a random hidden gem you haven't seen before
- **Save Places** — Bookmark favourites for later
- **Memories** — Create journal entries for places you've visited, with photo/video uploads
- **PWA** — Install on your phone for an app-like experience with offline caching
- **Admin Panel** — User management, data sync, and scheduled backups
- **2FA** — Optional TOTP two-factor authentication with backup codes
- **Security Hardened** — Rate limiting, account lockout, CSP, HSTS, audit logging

## Quick Deploy

The easiest way to run Quiet Isles — just download `docker-compose.deploy.yml` and start:

```bash
curl -O https://raw.githubusercontent.com/aiulian25/QuietIsles/main/docker-compose.deploy.yml
docker compose -f docker-compose.deploy.yml up -d
```

The app will be available at **http://localhost:2145**

On first launch, you'll be prompted to create an admin account.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `change-me-in-production` | Flask session secret — **change this** |
| `DATA_DIR` | `/app/data` | Data directory inside the container |

Set your secret key:

```bash
SECRET_KEY=$(openssl rand -hex 32) docker compose -f docker-compose.deploy.yml up -d
```

Or create a `.env` file next to the compose file:

```
SECRET_KEY=your-random-secret-here
```

### Data Persistence

All data (database, uploaded media, backups) is stored in a `./data` volume mount. Back up this directory to preserve your data.

## Development

To build from source:

```bash
git clone https://github.com/aiulian25/QuietIsles.git
cd QuietIsles
docker compose up -d --build
```

## Tech Stack

- **Backend** — Python / Flask / Gunicorn / SQLite
- **Frontend** — Vanilla JS SPA / Tailwind CSS / Leaflet maps
- **Container** — Multi-stage Docker build (Node for Tailwind, Python 3.11-slim for runtime)

## License

MIT
