import os
import io
import secrets
import hashlib
import hmac
import time
import base64
import struct
from datetime import datetime
from models import get_db


# --- Password Hashing (bcrypt via passlib) ---

def hash_password(password):
    """Hash password using PBKDF2-SHA256 (no external dependency)."""
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 310000)
    return base64.b64encode(salt + key).decode()


def verify_password(password, stored_hash):
    """Verify password against stored PBKDF2-SHA256 hash."""
    decoded = base64.b64decode(stored_hash)
    salt = decoded[:32]
    stored_key = decoded[32:]
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 310000)
    return hmac.compare_digest(key, stored_key)


# --- TOTP (RFC 6238) ---

def generate_totp_secret():
    """Generate a base32-encoded TOTP secret."""
    return base64.b32encode(os.urandom(20)).decode().rstrip('=')


def _hotp(secret, counter):
    """HMAC-based One-Time Password (RFC 4226)."""
    # Pad secret to base32
    padded = secret.upper() + '=' * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded)
    msg = struct.pack('>Q', counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    code = struct.unpack('>I', h[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % 1000000).zfill(6)


def verify_totp(secret, code, window=1):
    """Verify a TOTP code with time window tolerance."""
    if not secret or not code:
        return False
    counter = int(time.time()) // 30
    for i in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, counter + i), code.strip()):
            return True
    return False


def get_totp_uri(secret, username, issuer="Quiet Isles"):
    """Generate otpauth:// URI for QR code scanning."""
    padded = secret.upper() + '=' * ((8 - len(secret) % 8) % 8)
    return f"otpauth://totp/{issuer}:{username}?secret={padded}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"


# --- Backup Codes ---

def generate_backup_codes(count=10):
    """Generate a set of single-use backup codes."""
    codes = []
    for _ in range(count):
        code = secrets.token_hex(4).upper()  # 8 char hex codes
        codes.append(code)
    return codes


def hash_backup_code(code):
    """Hash a backup code for storage."""
    return hashlib.sha256(code.encode()).hexdigest()


# --- User Database Operations ---

def init_auth_db():
    """Create the users table and migrate saved_places if needed."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT DEFAULT '',
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            is_active INTEGER DEFAULT 1,
            totp_secret TEXT DEFAULT '',
            totp_enabled INTEGER DEFAULT 0,
            backup_codes TEXT DEFAULT '',
            interests TEXT DEFAULT '',
            last_surprise_date TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    """)
    # Migrate saved_places to use user_id if column doesn't exist
    try:
        conn.execute("ALTER TABLE saved_places ADD COLUMN user_id INTEGER REFERENCES users(id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_places(user_id)")
    except Exception:
        pass
    # Migrate: add interests/last_surprise_date columns to existing users table
    for col, default in [("interests", "''"), ("last_surprise_date", "''")]:
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT DEFAULT {default}")
        except Exception:
            pass

    # Memories tables
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            place_id INTEGER,
            title TEXT NOT NULL,
            notes TEXT DEFAULT '',
            rating INTEGER DEFAULT 0,
            visited_date TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (place_id) REFERENCES places(id)
        );

        CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
        CREATE INDEX IF NOT EXISTS idx_memories_place ON memories(place_id);

        CREATE TABLE IF NOT EXISTS memory_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT DEFAULT '',
            media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
            file_size INTEGER DEFAULT 0,
            caption TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_media_memory ON memory_media(memory_id);
    """)

    conn.commit()
    conn.close()


def get_user_count():
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn.close()
    return count


def create_user(username, password, role='user', display_name=''):
    """Create a new user. Returns user dict or None if username taken."""
    conn = get_db()
    try:
        pw_hash = hash_password(password)
        conn.execute(
            "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)",
            (username, display_name or username, pw_hash, role)
        )
        conn.commit()
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.close()
        return {"id": user_id, "username": username, "display_name": display_name or username, "role": role}
    except Exception:
        conn.close()
        return None


def authenticate_user(username, password):
    """Verify credentials. Returns user dict or None."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        return None
    user = dict(row)
    if not user["is_active"]:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


def get_user_by_id(user_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_users():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, display_name, role, is_active, totp_enabled, created_at FROM users ORDER BY created_at"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_user_profile(user_id, display_name=None, password=None):
    conn = get_db()
    if display_name is not None:
        conn.execute("UPDATE users SET display_name = ? WHERE id = ?", (display_name, user_id))
    if password is not None:
        pw_hash = hash_password(password)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, user_id))
    conn.commit()
    conn.close()


def set_user_active(user_id, active):
    conn = get_db()
    conn.execute("UPDATE users SET is_active = ? WHERE id = ?", (1 if active else 0, user_id))
    conn.commit()
    conn.close()


def delete_user(user_id):
    """Delete user and all associated data."""
    conn = get_db()
    conn.execute("DELETE FROM saved_places WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()


def setup_totp(user_id):
    """Generate and store a TOTP secret (not yet enabled)."""
    secret = generate_totp_secret()
    conn = get_db()
    conn.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (secret, user_id))
    conn.commit()
    conn.close()
    return secret


def enable_totp(user_id, code):
    """Enable 2FA after verifying a code. Returns backup codes on success."""
    user = get_user_by_id(user_id)
    if not user or not user["totp_secret"]:
        return None
    if not verify_totp(user["totp_secret"], code):
        return None
    codes = generate_backup_codes()
    hashed = ",".join(hash_backup_code(c) for c in codes)
    conn = get_db()
    conn.execute(
        "UPDATE users SET totp_enabled = 1, backup_codes = ? WHERE id = ?",
        (hashed, user_id)
    )
    conn.commit()
    conn.close()
    return codes


def disable_totp(user_id):
    conn = get_db()
    conn.execute(
        "UPDATE users SET totp_enabled = 0, totp_secret = '', backup_codes = '' WHERE id = ?",
        (user_id,)
    )
    conn.commit()
    conn.close()


def verify_backup_code(user_id, code):
    """Verify and consume a backup code."""
    user = get_user_by_id(user_id)
    if not user or not user["backup_codes"]:
        return False
    hashed_input = hash_backup_code(code.strip().upper())
    stored = user["backup_codes"].split(",")
    if hashed_input in stored:
        stored.remove(hashed_input)
        conn = get_db()
        conn.execute("UPDATE users SET backup_codes = ? WHERE id = ?", (",".join(stored), user_id))
        conn.commit()
        conn.close()
        return True
    return False


def generate_backup_codes_pdf(username, codes):
    """Generate a PDF containing backup codes. Returns bytes."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas
    except ImportError:
        return _generate_simple_pdf(username, codes)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    date_str = datetime.now().strftime("%Y-%m-%d")

    # Title
    c.setFont("Helvetica-Bold", 22)
    c.drawString(40, h - 60, "Quiet Isles — Backup Codes")

    # Subtitle
    c.setFont("Helvetica", 12)
    c.drawString(40, h - 85, f"User: {username}  |  Generated: {date_str}")

    # Divider
    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    c.line(40, h - 100, w - 40, h - 100)

    # Instructions
    c.setFont("Helvetica", 10)
    c.drawString(40, h - 125, "Each code can only be used once. Store these in a safe place.")
    c.drawString(40, h - 140, "Use a backup code if you lose access to your authenticator app.")

    # Codes grid (2 columns)
    c.setFont("Courier-Bold", 14)
    y = h - 180
    for i, code in enumerate(codes):
        col = i % 2
        x = 60 + col * 240
        if col == 0 and i > 0:
            y -= 35

        # Code box
        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.setFillColorRGB(0.97, 0.97, 0.97)
        c.roundRect(x - 10, y - 8, 200, 30, 4, fill=1, stroke=1)

        c.setFillColorRGB(0, 0, 0)
        c.drawString(x + 10, y, f"{i + 1:2d}.  {code}")

    # Footer
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawString(40, 40, f"Quiet Isles — {username} — {date_str}")

    c.save()
    buf.seek(0)
    return buf.read()


def _generate_simple_pdf(username, codes):
    """Fallback PDF generation without reportlab (plain text format)."""
    date_str = datetime.now().strftime("%Y-%m-%d")
    lines = [
        f"Quiet Isles - Backup Codes",
        f"User: {username}",
        f"Generated: {date_str}",
        "",
        "Each code can only be used once.",
        "Store these in a safe place.",
        "",
    ]
    for i, code in enumerate(codes):
        lines.append(f"  {i + 1:2d}.  {code}")
    lines.append("")
    lines.append(f"Quiet Isles - {username} - {date_str}")
    content = "\n".join(lines)
    return content.encode()


# --- Saved Places (user-based) ---

def get_user_saved_places(user_id):
    conn = get_db()
    rows = conn.execute("""
        SELECT p.*, sp.created_at as saved_at
        FROM saved_places sp
        JOIN places p ON sp.place_id = p.id
        WHERE sp.user_id = ?
        ORDER BY sp.created_at DESC
    """, (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_place_for_user(user_id, place_id):
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO saved_places (session_id, place_id, user_id) VALUES ('', ?, ?)",
            (place_id, user_id)
        )
        conn.commit()
    finally:
        conn.close()


def unsave_place_for_user(user_id, place_id):
    conn = get_db()
    try:
        conn.execute("DELETE FROM saved_places WHERE user_id = ? AND place_id = ?", (user_id, place_id))
        conn.commit()
    finally:
        conn.close()


def is_place_saved_by_user(user_id, place_id):
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM saved_places WHERE user_id = ? AND place_id = ?",
        (user_id, place_id)
    ).fetchone()
    conn.close()
    return row is not None


# --- User Interests ---

def get_user_interests(user_id):
    """Return list of category keys the user is interested in."""
    conn = get_db()
    row = conn.execute("SELECT interests FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row or not row["interests"]:
        return []
    return [c.strip() for c in row["interests"].split(",") if c.strip()]


def set_user_interests(user_id, categories):
    """Store user interests as comma-separated category keys."""
    conn = get_db()
    conn.execute(
        "UPDATE users SET interests = ? WHERE id = ?",
        (",".join(categories), user_id)
    )
    conn.commit()
    conn.close()


def get_last_surprise_date(user_id):
    conn = get_db()
    row = conn.execute("SELECT last_surprise_date FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row["last_surprise_date"] if row else ""


def set_last_surprise_date(user_id, date_str):
    conn = get_db()
    conn.execute("UPDATE users SET last_surprise_date = ? WHERE id = ?", (date_str, user_id))
    conn.commit()
    conn.close()


# --- Memories ---

def create_memory(user_id, title, place_id=None, notes="", rating=0, visited_date=""):
    conn = get_db()
    cursor = conn.execute(
        """INSERT INTO memories (user_id, place_id, title, notes, rating, visited_date)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user_id, place_id or None, title, notes, min(max(rating, 0), 5), visited_date)
    )
    memory_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return memory_id


def get_user_memories(user_id):
    conn = get_db()
    rows = conn.execute("""
        SELECT m.*, p.name AS place_name, p.category AS place_category,
               p.image_url AS place_image, p.county AS place_county
        FROM memories m
        LEFT JOIN places p ON m.place_id = p.id
        WHERE m.user_id = ?
        ORDER BY m.created_at DESC
    """, (user_id,)).fetchall()
    memories = []
    for r in rows:
        mem = dict(r)
        media = conn.execute(
            "SELECT id, filename, original_name, media_type, file_size, caption FROM memory_media WHERE memory_id = ? ORDER BY created_at",
            (mem["id"],)
        ).fetchall()
        mem["media"] = [dict(m) for m in media]
        memories.append(mem)
    conn.close()
    return memories


def get_memory_by_id(memory_id, user_id):
    conn = get_db()
    row = conn.execute("""
        SELECT m.*, p.name AS place_name, p.category AS place_category,
               p.image_url AS place_image, p.county AS place_county
        FROM memories m
        LEFT JOIN places p ON m.place_id = p.id
        WHERE m.id = ? AND m.user_id = ?
    """, (memory_id, user_id)).fetchone()
    if not row:
        conn.close()
        return None
    mem = dict(row)
    media = conn.execute(
        "SELECT id, filename, original_name, media_type, file_size, caption FROM memory_media WHERE memory_id = ? ORDER BY created_at",
        (memory_id,)
    ).fetchall()
    mem["media"] = [dict(m) for m in media]
    conn.close()
    return mem


def update_memory(memory_id, user_id, title=None, notes=None, rating=None, visited_date=None, place_id=None):
    conn = get_db()
    sets, params = [], []
    if title is not None:
        sets.append("title = ?"); params.append(title)
    if notes is not None:
        sets.append("notes = ?"); params.append(notes)
    if rating is not None:
        sets.append("rating = ?"); params.append(min(max(rating, 0), 5))
    if visited_date is not None:
        sets.append("visited_date = ?"); params.append(visited_date)
    if place_id is not None:
        sets.append("place_id = ?"); params.append(place_id or None)
    if sets:
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([memory_id, user_id])
        conn.execute(f"UPDATE memories SET {', '.join(sets)} WHERE id = ? AND user_id = ?", params)
        conn.commit()
    conn.close()


def delete_memory(memory_id, user_id):
    """Delete memory and return list of media filenames to clean up."""
    conn = get_db()
    files = conn.execute(
        "SELECT filename FROM memory_media WHERE memory_id = ? AND EXISTS (SELECT 1 FROM memories WHERE id = ? AND user_id = ?)",
        (memory_id, memory_id, user_id)
    ).fetchall()
    filenames = [f["filename"] for f in files]
    conn.execute("DELETE FROM memory_media WHERE memory_id = ?", (memory_id,))
    conn.execute("DELETE FROM memories WHERE id = ? AND user_id = ?", (memory_id, user_id))
    conn.commit()
    conn.close()
    return filenames


def add_memory_media(memory_id, filename, original_name, media_type, file_size, caption=""):
    conn = get_db()
    conn.execute(
        """INSERT INTO memory_media (memory_id, filename, original_name, media_type, file_size, caption)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (memory_id, filename, original_name, media_type, file_size, caption)
    )
    conn.commit()
    conn.close()


def delete_memory_media(media_id, user_id):
    """Delete a single media item. Returns filename for cleanup or None."""
    conn = get_db()
    row = conn.execute("""
        SELECT mm.filename FROM memory_media mm
        JOIN memories m ON mm.memory_id = m.id
        WHERE mm.id = ? AND m.user_id = ?
    """, (media_id, user_id)).fetchone()
    if not row:
        conn.close()
        return None
    conn.execute("DELETE FROM memory_media WHERE id = ?", (media_id,))
    conn.commit()
    conn.close()
    return row["filename"]
