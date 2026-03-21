# Stage 1: Build Tailwind CSS
FROM node:20-alpine AS tailwind-build
WORKDIR /build
COPY frontend/tailwind.config.js .
COPY frontend/css/tailwind-input.css css/
COPY frontend/index.html .
COPY frontend/js/ js/
RUN npm install -D tailwindcss@3 && \
    npx tailwindcss -i css/tailwind-input.css -o css/tailwind.css --minify

# Stage 2: Production image
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install minimal dependencies and apply security patches
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with UID 1000 to match host volume ownership
RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -d /app -s /sbin/nologin appuser

# Create app directories
RUN mkdir -p /app/backend /app/frontend /app/data && chown -R appuser:appuser /app

WORKDIR /app

# Upgrade pip/setuptools/wheel to fix known CVEs, then install app dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r /app/backend/requirements.txt && \
    pip cache purge 2>/dev/null; true

# Copy backend
COPY backend/ /app/backend/
RUN chmod +x /app/backend/entrypoint.sh

# Copy frontend
COPY frontend/ /app/frontend/

# Copy built Tailwind CSS from stage 1
COPY --from=tailwind-build /build/css/tailwind.css /app/frontend/css/tailwind.css

# Copy logo (renamed during build context due to spaces)
COPY logo.png /app/Quiet_Isles.png

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

WORKDIR /app/backend

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:2145/api/stats || exit 1

EXPOSE 2145

# Initialize DB then start gunicorn
CMD ["/app/backend/entrypoint.sh"]
