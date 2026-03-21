#!/bin/sh
set -e

# Ensure /app/data is writable by appuser (UID 1000)
# When Docker creates the bind mount directory on the host, it may be owned by root
if [ ! -w /app/data ]; then
    echo "Warning: /app/data is not writable. Ensure the host directory is owned by UID 1000."
    echo "Fix: sudo chown -R 1000:1000 ./data"
    exit 1
fi

# Initialize database
python -c 'from models import init_db; init_db(); from auth import init_auth_db; init_auth_db()'

# Start gunicorn
exec gunicorn -c gunicorn.conf.py main:app
