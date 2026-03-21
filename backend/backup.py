import os
import io
import json
import shutil
import zipfile
import threading
import time
import logging
from datetime import datetime, timedelta
from config import DATA_DIR, DB_PATH

logger = logging.getLogger(__name__)

BACKUP_DIR = os.path.join(DATA_DIR, "backups")
MEDIA_DIR = os.path.join(DATA_DIR, "media")
SETTINGS_FILE = os.path.join(DATA_DIR, "backup_settings.json")

DEFAULT_SETTINGS = {
    "schedule": "off",       # off | weekly | monthly
    "max_backups": 5,
    "retention_days": 90,    # 0 = keep forever
    "last_backup": "",
    "next_backup": "",
}

_scheduler_thread = None
_scheduler_stop = threading.Event()


def _ensure_dirs():
    os.makedirs(BACKUP_DIR, exist_ok=True)


def get_backup_settings():
    if os.path.isfile(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
            # Merge with defaults for any missing keys
            for k, v in DEFAULT_SETTINGS.items():
                if k not in settings:
                    settings[k] = v
            return settings
        except (json.JSONDecodeError, IOError):
            pass
    return dict(DEFAULT_SETTINGS)


def save_backup_settings(settings):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


def _compute_next_backup(schedule, from_time=None):
    """Compute next backup time based on schedule."""
    if schedule == "off":
        return ""
    now = from_time or datetime.now()
    if schedule == "weekly":
        nxt = now + timedelta(weeks=1)
    elif schedule == "monthly":
        # Roughly 30 days
        nxt = now + timedelta(days=30)
    else:
        return ""
    return nxt.strftime("%Y-%m-%d %H:%M:%S")


def update_backup_settings(schedule=None, max_backups=None, retention_days=None):
    """Update backup settings and restart scheduler if needed."""
    settings = get_backup_settings()
    changed_schedule = False

    if schedule is not None and schedule in ("off", "weekly", "monthly"):
        if settings["schedule"] != schedule:
            changed_schedule = True
        settings["schedule"] = schedule

    if max_backups is not None:
        settings["max_backups"] = max(1, min(int(max_backups), 100))

    if retention_days is not None:
        settings["retention_days"] = max(0, min(int(retention_days), 3650))

    if changed_schedule:
        settings["next_backup"] = _compute_next_backup(settings["schedule"])

    save_backup_settings(settings)

    # Restart scheduler
    start_scheduler()

    return settings


def create_backup(label="manual"):
    """Create a backup zip containing DB + media + metadata. Returns filename or raises."""
    _ensure_dirs()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"quietisles_backup_{timestamp}_{label}.zip"
    filepath = os.path.join(BACKUP_DIR, filename)

    # Metadata
    meta = {
        "version": "1.0",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "label": label,
        "db_included": False,
        "media_count": 0,
        "media_size_bytes": 0,
    }

    with zipfile.ZipFile(filepath, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add database
        if os.path.isfile(DB_PATH):
            zf.write(DB_PATH, "quietisles.db")
            meta["db_included"] = True

        # Add media files
        if os.path.isdir(MEDIA_DIR):
            media_total = 0
            for fname in os.listdir(MEDIA_DIR):
                fpath = os.path.join(MEDIA_DIR, fname)
                if os.path.isfile(fpath):
                    zf.write(fpath, f"media/{fname}")
                    meta["media_count"] += 1
                    media_total += os.path.getsize(fpath)
            meta["media_size_bytes"] = media_total

        # Add metadata
        zf.writestr("backup_meta.json", json.dumps(meta, indent=2))

    # Update last_backup timestamp
    settings = get_backup_settings()
    settings["last_backup"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if settings["schedule"] != "off":
        settings["next_backup"] = _compute_next_backup(settings["schedule"])
    save_backup_settings(settings)

    # Enforce retention
    _enforce_retention()

    return filename


def list_backups():
    """Return list of backup info dicts sorted newest first."""
    _ensure_dirs()
    backups = []
    for fname in os.listdir(BACKUP_DIR):
        if not fname.endswith(".zip"):
            continue
        fpath = os.path.join(BACKUP_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        size = os.path.getsize(fpath)
        mtime = os.path.getmtime(fpath)
        created = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")

        # Try to read metadata from zip
        meta = {}
        try:
            with zipfile.ZipFile(fpath, "r") as zf:
                if "backup_meta.json" in zf.namelist():
                    meta = json.loads(zf.read("backup_meta.json"))
        except (zipfile.BadZipFile, json.JSONDecodeError, IOError):
            pass

        backups.append({
            "filename": fname,
            "size": size,
            "created_at": meta.get("created_at", created),
            "label": meta.get("label", ""),
            "db_included": meta.get("db_included", False),
            "media_count": meta.get("media_count", 0),
        })

    backups.sort(key=lambda b: b["created_at"], reverse=True)
    return backups


def delete_backup(filename):
    """Delete a backup file. Returns True if deleted."""
    safe = os.path.basename(filename)
    if safe != filename or ".." in filename:
        return False
    fpath = os.path.join(BACKUP_DIR, safe)
    if os.path.isfile(fpath):
        os.remove(fpath)
        return True
    return False


def get_backup_path(filename):
    """Return full path to a backup file if it exists, else None."""
    safe = os.path.basename(filename)
    if safe != filename or ".." in filename:
        return None
    fpath = os.path.join(BACKUP_DIR, safe)
    if os.path.isfile(fpath):
        return fpath
    return None


def validate_backup_zip(filepath):
    """Validate a backup zip file has required contents. Returns meta dict or raises ValueError."""
    try:
        with zipfile.ZipFile(filepath, "r") as zf:
            names = zf.namelist()
            if "quietisles.db" not in names:
                raise ValueError("Invalid backup: missing database file")
            if "backup_meta.json" in names:
                meta = json.loads(zf.read("backup_meta.json"))
            else:
                meta = {"version": "unknown", "created_at": "unknown"}
            return meta
    except zipfile.BadZipFile:
        raise ValueError("Invalid file: not a valid zip archive")


def restore_backup(filepath):
    """Restore from a backup zip file. Replaces DB and media files."""
    meta = validate_backup_zip(filepath)

    with zipfile.ZipFile(filepath, "r") as zf:
        # Restore database
        db_data = zf.read("quietisles.db")
        # Write to a temp file first, then replace atomically
        tmp_db = DB_PATH + ".restore_tmp"
        with open(tmp_db, "wb") as f:
            f.write(db_data)

        # Replace the actual DB
        if os.path.isfile(DB_PATH):
            backup_current = DB_PATH + ".pre_restore"
            shutil.copy2(DB_PATH, backup_current)
        os.replace(tmp_db, DB_PATH)

        # Remove WAL/SHM files so SQLite reopens cleanly
        for suffix in ("-wal", "-shm"):
            wal_path = DB_PATH + suffix
            if os.path.isfile(wal_path):
                os.remove(wal_path)

        # Restore media files
        media_names = [n for n in zf.namelist() if n.startswith("media/") and not n.endswith("/")]
        if media_names:
            os.makedirs(MEDIA_DIR, exist_ok=True)
            # Clear existing media
            for existing in os.listdir(MEDIA_DIR):
                epath = os.path.join(MEDIA_DIR, existing)
                if os.path.isfile(epath):
                    os.remove(epath)
            # Extract new media
            for name in media_names:
                fname = os.path.basename(name)
                if not fname:
                    continue
                data = zf.read(name)
                with open(os.path.join(MEDIA_DIR, fname), "wb") as f:
                    f.write(data)

    return meta


def save_uploaded_backup(file_storage):
    """Save an uploaded backup file. Returns (filename, meta) or raises ValueError."""
    _ensure_dirs()

    # Save to temp location first
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"quietisles_backup_{timestamp}_uploaded.zip"
    filepath = os.path.join(BACKUP_DIR, filename)

    file_storage.save(filepath)

    try:
        meta = validate_backup_zip(filepath)
    except ValueError:
        os.remove(filepath)
        raise

    return filename, meta


def _enforce_retention():
    """Remove old backups exceeding max count or retention days."""
    settings = get_backup_settings()
    backups = list_backups()

    # Remove by count
    max_count = settings.get("max_backups", 5)
    if len(backups) > max_count:
        for old in backups[max_count:]:
            delete_backup(old["filename"])

    # Remove by age
    retention_days = settings.get("retention_days", 90)
    if retention_days > 0:
        cutoff = datetime.now() - timedelta(days=retention_days)
        cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
        # Re-fetch after count removal
        for b in list_backups():
            if b["created_at"] < cutoff_str:
                delete_backup(b["filename"])


def _scheduler_loop():
    """Background loop that creates scheduled backups."""
    logger.info("Backup scheduler started")
    while not _scheduler_stop.is_set():
        try:
            settings = get_backup_settings()
            schedule = settings.get("schedule", "off")
            next_backup = settings.get("next_backup", "")

            if schedule != "off" and next_backup:
                try:
                    next_dt = datetime.strptime(next_backup, "%Y-%m-%d %H:%M:%S")
                    if datetime.now() >= next_dt:
                        logger.info(f"Running scheduled {schedule} backup...")
                        create_backup(label=f"auto_{schedule}")
                        logger.info("Scheduled backup completed")
                except (ValueError, OSError) as e:
                    logger.error(f"Scheduled backup error: {e}")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")

        # Check every 5 minutes
        _scheduler_stop.wait(300)

    logger.info("Backup scheduler stopped")


def start_scheduler():
    """Start or restart the backup scheduler thread."""
    global _scheduler_thread
    stop_scheduler()

    settings = get_backup_settings()
    if settings["schedule"] == "off":
        return

    # Set next_backup if missing
    if not settings["next_backup"]:
        settings["next_backup"] = _compute_next_backup(settings["schedule"])
        save_backup_settings(settings)

    _scheduler_stop.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True)
    _scheduler_thread.start()


def stop_scheduler():
    """Stop the backup scheduler thread."""
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_stop.set()
        _scheduler_thread.join(timeout=10)
    _scheduler_thread = None
