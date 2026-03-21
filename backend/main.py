import os
import json
import uuid
import math
import logging
import threading
import functools
import time
from datetime import datetime, timedelta
from collections import defaultdict
from flask import Flask, jsonify, request, send_from_directory, send_file, session
from models import (
    init_db, get_places, get_place_by_id, get_featured_places,
    get_place_count, upsert_place, get_saved_places, save_place,
    unsave_place, is_place_saved, get_categories_with_counts,
    get_places_missing_location, update_place_location
)
from auth import (
    init_auth_db, get_user_count, create_user, authenticate_user,
    get_user_by_id, get_all_users, update_user_profile,
    set_user_active, delete_user as delete_user_data,
    setup_totp, enable_totp, disable_totp, verify_totp,
    verify_backup_code, get_totp_uri, generate_backup_codes_pdf,
    get_user_saved_places, save_place_for_user, unsave_place_for_user,
    is_place_saved_by_user,
    get_user_interests, set_user_interests,
    get_last_surprise_date, set_last_surprise_date,
    create_memory, get_user_memories, get_memory_by_id,
    update_memory, delete_memory, add_memory_media, delete_memory_media
)
from backup import (
    get_backup_settings, update_backup_settings, create_backup,
    list_backups, delete_backup as remove_backup, get_backup_path,
    restore_backup, save_uploaded_backup, validate_backup_zip,
    start_scheduler as start_backup_scheduler
)
from overpass import sync_places
from images import enrich_images, fetch_wikipedia_extracts, enrich_db_descriptions
from designations import sync_designations
from geocoding import search_places as nominatim_search, batch_reverse_geocode
from config import (
    STATIC_DIR, DATA_DIR, LOGO_PATH, PORT, PLACE_CATEGORIES,
    DESIGNATION_CATEGORIES, GEOCODE_BATCH_SIZE
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(32).hex())
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB upload limit

# --- Session hardening ---
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Strict"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
# SESSION_COOKIE_SECURE should be True behind HTTPS reverse proxy
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SECURE_COOKIES", "").lower() in ("1", "true", "yes")

# Start backup scheduler on import (works with gunicorn)
start_backup_scheduler()

# --- Rate Limiting (in-memory, per-worker) ---

class RateLimiter:
    """Simple in-memory rate limiter with sliding window."""

    def __init__(self):
        self._hits = defaultdict(list)   # key -> [timestamps]
        self._lock = threading.Lock()

    def is_limited(self, key, max_requests, window_seconds):
        """Return True if rate limit exceeded."""
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            hits = self._hits[key]
            # Prune old entries
            self._hits[key] = [t for t in hits if t > cutoff]
            if len(self._hits[key]) >= max_requests:
                return True
            self._hits[key].append(now)
            return False

    def cleanup(self):
        """Remove stale keys (call periodically)."""
        now = time.monotonic()
        with self._lock:
            stale = [k for k, v in self._hits.items() if not v or v[-1] < now - 3600]
            for k in stale:
                del self._hits[k]


_rate_limiter = RateLimiter()

# --- Account lockout tracking ---
_failed_logins = defaultdict(list)  # ip -> [timestamps]
_failed_lock = threading.Lock()
LOCKOUT_THRESHOLD = 5       # lock after 5 failed attempts
LOCKOUT_WINDOW = 600        # within 10 minutes
LOCKOUT_DURATION = 900      # lock for 15 minutes


def _check_account_lockout(ip):
    """Return True if IP is locked out from login."""
    now = time.monotonic()
    with _failed_lock:
        attempts = _failed_logins.get(ip, [])
        # Only consider attempts within lockout window
        recent = [t for t in attempts if t > now - LOCKOUT_WINDOW]
        _failed_logins[ip] = recent
        if len(recent) >= LOCKOUT_THRESHOLD:
            # Check if still within lockout duration from last attempt
            if recent and (now - recent[-1]) < LOCKOUT_DURATION:
                return True
    return False


def _record_failed_login(ip):
    """Record a failed login attempt."""
    now = time.monotonic()
    with _failed_lock:
        _failed_logins[ip].append(now)
        # Keep only recent entries
        _failed_logins[ip] = [t for t in _failed_logins[ip] if t > now - LOCKOUT_WINDOW]


# --- General API rate limiting ---

@app.before_request
def check_api_rate_limit():
    """Rate limit API write operations: 60 requests/minute per IP."""
    if not request.path.startswith("/api/"):
        return None
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    if _rate_limiter.is_limited(f"api_write:{client_ip}", 60, 60):
        return jsonify({"error": "Rate limit exceeded. Please slow down."}), 429
    return None


# Sync state
sync_status = {"running": False, "message": "", "progress": 0, "errors": []}


def get_current_user():
    """Get current logged-in user from session."""
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_user_by_id(user_id)


def login_required(f):
    """Decorator requiring authentication."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        return f(user, *args, **kwargs)
    return decorated


def admin_required(f):
    """Decorator requiring admin role."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        if user["role"] != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(user, *args, **kwargs)
    return decorated


def ensure_session():
    if "sid" not in session:
        session["sid"] = str(uuid.uuid4())
    return session["sid"]


# --- Auth API Routes ---

@app.route("/api/auth/setup-status")
def api_auth_setup_status():
    """Check if initial setup is needed (no users exist yet)."""
    count = get_user_count()
    user = get_current_user()
    return jsonify({
        "needs_setup": count == 0,
        "authenticated": user is not None,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "totp_enabled": bool(user["totp_enabled"]),
            "interests": [c for c in (user.get("interests") or "").split(",") if c],
        } if user else None,
    })


@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    """Register the first user (becomes admin). No other self-registration allowed."""
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()

    # Rate limit registration attempts
    if _rate_limiter.is_limited(f"register:{client_ip}", 3, 600):
        return jsonify({"error": "Too many attempts. Please try again later."}), 429

    count = get_user_count()
    if count > 0:
        return jsonify({"error": "Registration is disabled. Contact an admin."}), 403

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip()

    if not username or len(username) < 3 or len(username) > 50:
        return jsonify({"error": "Username must be 3-50 characters"}), 400
    if not username.replace("_", "").replace("-", "").isalnum():
        return jsonify({"error": "Username can only contain letters, numbers, hyphens and underscores"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    user = create_user(username, password, role='admin', display_name=display_name or username)
    if not user:
        return jsonify({"error": "Username already taken"}), 409

    session["user_id"] = user["id"]
    session.permanent = True
    return jsonify({"user": user}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()

    # Rate limit: 10 login attempts per 10 minutes per IP
    if _rate_limiter.is_limited(f"login:{client_ip}", 10, 600):
        logger.warning(f"Login rate limit hit for IP {client_ip}")
        return jsonify({"error": "Too many login attempts. Please try again later."}), 429

    # Account lockout check
    if _check_account_lockout(client_ip):
        logger.warning(f"Account lockout active for IP {client_ip}")
        return jsonify({"error": "Account temporarily locked due to too many failed attempts. Try again in 15 minutes."}), 429

    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    totp_code = (data.get("totp_code") or "").strip()
    backup_code = (data.get("backup_code") or "").strip()

    user = authenticate_user(username, password)
    if not user:
        _record_failed_login(client_ip)
        logger.warning(f"Failed login attempt for user '{username}' from {client_ip}")
        return jsonify({"error": "Invalid username or password"}), 401

    # Check 2FA if enabled
    if user["totp_enabled"]:
        if backup_code:
            if not verify_backup_code(user["id"], backup_code):
                _record_failed_login(client_ip)
                logger.warning(f"Failed backup code for user '{username}' from {client_ip}")
                return jsonify({"error": "Invalid backup code"}), 401
        elif totp_code:
            if not verify_totp(user["totp_secret"], totp_code):
                _record_failed_login(client_ip)
                logger.warning(f"Failed 2FA code for user '{username}' from {client_ip}")
                return jsonify({"error": "Invalid 2FA code"}), 401
        else:
            return jsonify({"requires_2fa": True}), 200

    logger.info(f"Successful login for user '{username}' from {client_ip}")
    session["user_id"] = user["id"]
    session.permanent = True
    return jsonify({
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "totp_enabled": bool(user["totp_enabled"]),
            "interests": [c for c in (user.get("interests") or "").split(",") if c],
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me")
@login_required
def api_auth_me(user):
    return jsonify({
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "totp_enabled": bool(user["totp_enabled"]),
            "interests": [c for c in (user.get("interests") or "").split(",") if c],
        }
    })


@app.route("/api/auth/profile", methods=["PUT"])
@login_required
def api_auth_profile(user):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    display_name = data.get("display_name")
    current_password = data.get("current_password")
    new_password = data.get("new_password")

    if display_name is not None:
        display_name = display_name.strip()
        if len(display_name) > 100:
            return jsonify({"error": "Display name too long"}), 400

    if new_password:
        if not current_password:
            return jsonify({"error": "Current password is required"}), 400
        from auth import verify_password
        if not verify_password(current_password, user["password_hash"]):
            return jsonify({"error": "Current password is incorrect"}), 400
        if len(new_password) < 8:
            return jsonify({"error": "New password must be at least 8 characters"}), 400

    update_user_profile(
        user["id"],
        display_name=display_name,
        password=new_password if new_password else None
    )
    updated = get_user_by_id(user["id"])
    return jsonify({
        "user": {
            "id": updated["id"],
            "username": updated["username"],
            "display_name": updated["display_name"],
            "role": updated["role"],
            "totp_enabled": bool(updated["totp_enabled"]),
            "interests": [c for c in (updated.get("interests") or "").split(",") if c],
        }
    })


# --- 2FA Routes ---

@app.route("/api/auth/2fa/setup", methods=["POST"])
@login_required
def api_2fa_setup(user):
    """Generate TOTP secret and return QR code URI."""
    if user["totp_enabled"]:
        return jsonify({"error": "2FA is already enabled"}), 400
    secret = setup_totp(user["id"])
    uri = get_totp_uri(secret, user["username"])
    return jsonify({"secret": secret, "uri": uri})


@app.route("/api/auth/2fa/enable", methods=["POST"])
@login_required
def api_2fa_enable(user):
    """Verify TOTP code and enable 2FA. Returns backup codes."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    code = (data.get("code") or "").strip()
    if not code or len(code) != 6:
        return jsonify({"error": "Please enter a 6-digit code"}), 400
    codes = enable_totp(user["id"], code)
    if not codes:
        return jsonify({"error": "Invalid code. Make sure your authenticator is synced."}), 400
    return jsonify({"backup_codes": codes})


@app.route("/api/auth/2fa/disable", methods=["POST"])
@login_required
def api_2fa_disable(user):
    """Disable 2FA (requires password confirmation)."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    password = data.get("password") or ""
    from auth import verify_password
    if not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Incorrect password"}), 400
    disable_totp(user["id"])
    return jsonify({"ok": True})


@app.route("/api/auth/2fa/backup-codes.pdf")
@login_required
def api_2fa_backup_pdf(user):
    """Regenerate backup codes and return as PDF."""
    if not user["totp_enabled"]:
        return jsonify({"error": "2FA is not enabled"}), 400

    from auth import generate_backup_codes, hash_backup_code
    codes = generate_backup_codes()
    hashed = ",".join(hash_backup_code(c) for c in codes)
    from models import get_db
    conn = get_db()
    conn.execute("UPDATE users SET backup_codes = ? WHERE id = ?", (hashed, user["id"]))
    conn.commit()
    conn.close()

    pdf_bytes = generate_backup_codes_pdf(user["username"], codes)
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"QuietIsles_{user['username']}_{date_str}_backup_codes.pdf"

    import io
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename
    )


# --- Admin User Management ---

@app.route("/api/admin/users")
@admin_required
def api_admin_users(user):
    users = get_all_users()
    return jsonify({"users": users})


@app.route("/api/admin/users", methods=["POST"])
@admin_required
def api_admin_create_user(user):
    """Create a managed user (admin only)."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip()
    role = data.get("role", "user")

    if not username or len(username) < 3 or len(username) > 50:
        return jsonify({"error": "Username must be 3-50 characters"}), 400
    if not username.replace("_", "").replace("-", "").isalnum():
        return jsonify({"error": "Username can only contain letters, numbers, hyphens and underscores"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    if role not in ("admin", "user"):
        return jsonify({"error": "Invalid role"}), 400

    new_user = create_user(username, password, role=role, display_name=display_name or username)
    if not new_user:
        return jsonify({"error": "Username already taken"}), 409
    logger.info(f"AUDIT: Admin '{user['username']}' created user '{username}' (role={role})")
    return jsonify({"user": new_user}), 201


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
@admin_required
def api_admin_delete_user(user, user_id):
    """Delete a user and all their data."""
    if user_id == user["id"]:
        return jsonify({"error": "Cannot delete your own account"}), 400
    target = get_user_by_id(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    logger.info(f"AUDIT: Admin '{user['username']}' deleted user '{target['username']}' (id={user_id})")
    delete_user_data(user_id)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>/disable", methods=["POST"])
@admin_required
def api_admin_disable_user(user, user_id):
    if user_id == user["id"]:
        return jsonify({"error": "Cannot disable your own account"}), 400
    target = get_user_by_id(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    logger.info(f"AUDIT: Admin '{user['username']}' disabled user '{target['username']}' (id={user_id})")
    set_user_active(user_id, False)
    return jsonify({"ok": True})


@app.route("/api/admin/users/<int:user_id>/enable", methods=["POST"])
@admin_required
def api_admin_enable_user(user, user_id):
    target = get_user_by_id(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    logger.info(f"AUDIT: Admin '{user['username']}' enabled user '{target['username']}' (id={user_id})")
    set_user_active(user_id, True)
    return jsonify({"ok": True})


# --- API Routes ---

@app.route("/api/places")
@login_required
def api_places(user):
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    radius = request.args.get("radius_km", default=50, type=float)
    radius = min(max(radius, 1), 500)  # clamp to 1-500km
    category = request.args.get("category", default="all")
    page = request.args.get("page", default=1, type=int)
    page = max(page, 1)
    search = request.args.get("q")
    per_page = request.args.get("per_page", default=20, type=int)
    per_page = min(max(per_page, 1), 100)

    places = get_places(lat=lat, lon=lon, radius_km=radius,
                        category=category, page=page, per_page=per_page, search=search)

    for p in places:
        p["is_saved"] = is_place_saved_by_user(user["id"], p["id"])

    return jsonify({"places": places, "page": page, "per_page": per_page})


@app.route("/api/places/featured")
@login_required
def api_featured(user):
    places = get_featured_places(limit=8)
    for p in places:
        p["is_saved"] = is_place_saved_by_user(user["id"], p["id"])
    return jsonify({"places": places})


@app.route("/api/places/<int:place_id>")
@login_required
def api_place_detail(user, place_id):
    place = get_place_by_id(place_id)
    if not place:
        return jsonify({"error": "Place not found"}), 404
    place["is_saved"] = is_place_saved_by_user(user["id"], place["id"])
    return jsonify(place)


@app.route("/api/places/search")
@login_required
def api_search(user):
    q = request.args.get("q", "").strip()
    if not q or len(q) > 200:
        return jsonify({"places": []})

    # Search local DB first
    places = get_places(search=q, per_page=20)

    # Also search Nominatim for geocoding
    nominatim_results = nominatim_search(q, limit=5)

    return jsonify({
        "places": places,
        "geocoding": [{
            "name": r.get("display_name", ""),
            "lat": float(r.get("lat", 0)),
            "lon": float(r.get("lon", 0)),
        } for r in nominatim_results]
    })


@app.route("/api/categories")
def api_categories():
    db_cats = get_categories_with_counts()
    categories = []
    all_cats = {**PLACE_CATEGORIES, **DESIGNATION_CATEGORIES}
    for cat_key, cat_info in all_cats.items():
        count = next((c["count"] for c in db_cats if c["category"] == cat_key), 0)
        categories.append({
            "key": cat_key,
            "label": cat_info["label"],
            "icon": cat_info["icon"],
            "count": count,
        })
    return jsonify({"categories": categories, "total": get_place_count()})


@app.route("/api/saved")
@login_required
def api_saved(user):
    places = get_user_saved_places(user["id"])
    return jsonify({"places": places})


@app.route("/api/saved/<int:place_id>", methods=["POST"])
@login_required
def api_save(user, place_id):
    place = get_place_by_id(place_id)
    if not place:
        return jsonify({"error": "Place not found"}), 404
    save_place_for_user(user["id"], place_id)
    return jsonify({"saved": True})


@app.route("/api/saved/<int:place_id>", methods=["DELETE"])
@login_required
def api_unsave(user, place_id):
    unsave_place_for_user(user["id"], place_id)
    return jsonify({"saved": False})


# --- Interests & Personalisation ---

@app.route("/api/auth/interests")
@login_required
def api_get_interests(user):
    interests = get_user_interests(user["id"])
    return jsonify({"interests": interests})


@app.route("/api/auth/interests", methods=["PUT"])
@login_required
def api_set_interests(user):
    data = request.get_json()
    if not data or "interests" not in data:
        return jsonify({"error": "Invalid request"}), 400
    raw = data["interests"]
    if not isinstance(raw, list):
        return jsonify({"error": "interests must be a list"}), 400
    all_cats = set(PLACE_CATEGORIES.keys()) | set(DESIGNATION_CATEGORIES.keys())
    valid = [c for c in raw if c in all_cats]
    set_user_interests(user["id"], valid)
    return jsonify({"interests": valid})


@app.route("/api/places/for-you")
@login_required
def api_for_you(user):
    """Personalised places based on user interests + optional location."""
    interests = get_user_interests(user["id"])
    if not interests:
        return jsonify({"places": []})

    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    limit = request.args.get("limit", default=8, type=int)
    limit = min(max(limit, 1), 50)

    from models import get_db
    conn = get_db()
    placeholders = ",".join("?" * len(interests))

    if lat is not None and lon is not None:
        rows = conn.execute(f"""
            SELECT *,
                (({lat} - lat) * ({lat} - lat) + ({lon} - lon) * ({lon} - lon)) AS dist_sq
            FROM places
            WHERE category IN ({placeholders})
              AND name != ''
            ORDER BY
                CASE WHEN image_url != '' THEN 0 ELSE 1 END,
                dist_sq ASC,
                hidden_score DESC
            LIMIT ?
        """, (*interests, limit)).fetchall()
    else:
        rows = conn.execute(f"""
            SELECT *, NULL AS dist_sq FROM places
            WHERE category IN ({placeholders})
              AND name != ''
            ORDER BY
                CASE WHEN image_url != '' THEN 0 ELSE 1 END,
                hidden_score DESC,
                RANDOM()
            LIMIT ?
        """, (*interests, limit)).fetchall()

    conn.close()
    places = [dict(r) for r in rows]
    for p in places:
        p.pop("dist_sq", None)
        p["is_saved"] = is_place_saved_by_user(user["id"], p["id"])
    return jsonify({"places": places})


@app.route("/api/places/surprise")
@login_required
def api_surprise(user):
    """One surprise place outside user's preferred categories, near their location."""
    interests = get_user_interests(user["id"])
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)

    # Check if already shown today
    today = datetime.now().strftime("%Y-%m-%d")
    last = get_last_surprise_date(user["id"])
    if last == today:
        return jsonify({"place": None, "already_shown": True})

    from models import get_db
    conn = get_db()

    if interests:
        placeholders = ",".join("?" * len(interests))
        exclude_clause = f"AND category NOT IN ({placeholders})"
        params = list(interests)
    else:
        exclude_clause = ""
        params = []

    if lat is not None and lon is not None:
        rows = conn.execute(f"""
            SELECT *,
                (({lat} - lat) * ({lat} - lat) + ({lon} - lon) * ({lon} - lon)) AS dist_sq
            FROM places
            WHERE name != '' AND image_url != ''
              {exclude_clause}
            ORDER BY dist_sq ASC, RANDOM()
            LIMIT 20
        """, params).fetchall()
    else:
        rows = conn.execute(f"""
            SELECT *, NULL AS dist_sq FROM places
            WHERE name != '' AND image_url != ''
              {exclude_clause}
            ORDER BY hidden_score DESC, RANDOM()
            LIMIT 20
        """, params).fetchall()

    conn.close()

    if not rows:
        return jsonify({"place": None})

    # Pick a random one from the top candidates
    import random
    place = dict(random.choice(rows))
    place.pop("dist_sq", None)
    place["is_saved"] = is_place_saved_by_user(user["id"], place["id"])

    # Mark surprise as shown today
    set_last_surprise_date(user["id"], today)

    return jsonify({"place": place})


@app.route("/api/places/hidden-gems")
@login_required
def api_hidden_gems(user):
    """Places with high hidden_score that are genuine hidden gems."""
    from models import get_db
    limit = request.args.get("limit", default=20, type=int)
    limit = min(max(limit, 1), 100)
    conn = get_db()
    rows = conn.execute("""
        SELECT *, NULL AS distance_from_user FROM places
        WHERE hidden_score >= 0.5 AND name != ''
        ORDER BY
            CASE WHEN image_url != '' THEN 0 ELSE 1 END,
            hidden_score DESC,
            RANDOM()
        LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    places = [dict(r) for r in rows]
    for p in places:
        p["is_saved"] = is_place_saved_by_user(user["id"], p["id"])
    return jsonify({"places": places})


# --- Media config ---

MEDIA_DIR = os.path.join(DATA_DIR, "media")
os.makedirs(MEDIA_DIR, exist_ok=True)
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


# --- Memories API ---

@app.route("/api/memories")
@login_required
def api_get_memories(user):
    memories = get_user_memories(user["id"])
    for m in memories:
        for media in m.get("media", []):
            media["url"] = f"/api/media/{media['filename']}"
    return jsonify({"memories": memories})


@app.route("/api/memories", methods=["POST"])
@login_required
def api_create_memory(user):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    title = (data.get("title") or "").strip()
    if not title or len(title) > 200:
        return jsonify({"error": "Title is required (max 200 chars)"}), 400
    place_id = data.get("place_id")
    if place_id:
        place = get_place_by_id(place_id)
        if not place:
            return jsonify({"error": "Place not found"}), 404
    notes = (data.get("notes") or "")[:10000]
    rating = min(max(int(data.get("rating") or 0), 0), 5)
    visited_date = (data.get("visited_date") or "").strip()[:10]
    memory_id = create_memory(user["id"], title, place_id=place_id, notes=notes,
                              rating=rating, visited_date=visited_date)
    memory = get_memory_by_id(memory_id, user["id"])
    return jsonify({"memory": memory}), 201


@app.route("/api/memories/<int:memory_id>")
@login_required
def api_get_memory(user, memory_id):
    memory = get_memory_by_id(memory_id, user["id"])
    if not memory:
        return jsonify({"error": "Memory not found"}), 404
    for media in memory.get("media", []):
        media["url"] = f"/api/media/{media['filename']}"
    return jsonify({"memory": memory})


@app.route("/api/memories/<int:memory_id>", methods=["PUT"])
@login_required
def api_update_memory(user, memory_id):
    memory = get_memory_by_id(memory_id, user["id"])
    if not memory:
        return jsonify({"error": "Memory not found"}), 404
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    title = data.get("title")
    if title is not None:
        title = title.strip()
        if not title or len(title) > 200:
            return jsonify({"error": "Title is required (max 200 chars)"}), 400
    notes = data.get("notes")
    if notes is not None:
        notes = notes[:10000]
    rating = data.get("rating")
    if rating is not None:
        rating = int(rating)
    visited_date = data.get("visited_date")
    place_id = data.get("place_id")
    update_memory(memory_id, user["id"], title=title, notes=notes,
                  rating=rating, visited_date=visited_date, place_id=place_id)
    updated = get_memory_by_id(memory_id, user["id"])
    for media in updated.get("media", []):
        media["url"] = f"/api/media/{media['filename']}"
    return jsonify({"memory": updated})


@app.route("/api/memories/<int:memory_id>", methods=["DELETE"])
@login_required
def api_delete_memory(user, memory_id):
    memory = get_memory_by_id(memory_id, user["id"])
    if not memory:
        return jsonify({"error": "Memory not found"}), 404
    filenames = delete_memory(memory_id, user["id"])
    for fn in filenames:
        path = os.path.join(MEDIA_DIR, fn)
        if os.path.isfile(path):
            os.remove(path)
    return jsonify({"ok": True})


@app.route("/api/memories/<int:memory_id>/media", methods=["POST"])
@login_required
def api_upload_media(user, memory_id):
    memory = get_memory_by_id(memory_id, user["id"])
    if not memory:
        return jsonify({"error": "Memory not found"}), 404
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No file selected"}), 400

    content_type = f.content_type or ""
    if content_type in ALLOWED_IMAGE_TYPES:
        media_type = "image"
    elif content_type in ALLOWED_VIDEO_TYPES:
        media_type = "video"
    else:
        return jsonify({"error": f"File type not allowed. Accepted: JPEG, PNG, WebP, HEIC images and MP4, MOV, WebM videos."}), 400

    # Read file and check size
    data = f.read()
    if len(data) > MAX_FILE_SIZE:
        return jsonify({"error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)} MB."}), 400

    # Generate unique filename preserving extension
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".mp4", ".mov", ".webm", ".avi"):
        ext = ".bin"
    safe_name = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(MEDIA_DIR, safe_name)

    with open(filepath, "wb") as out:
        out.write(data)

    caption = request.form.get("caption", "").strip()[:500]
    add_memory_media(memory_id, safe_name, f.filename, media_type, len(data), caption)

    return jsonify({
        "media": {
            "filename": safe_name,
            "original_name": f.filename,
            "media_type": media_type,
            "file_size": len(data),
            "caption": caption,
            "url": f"/api/media/{safe_name}",
        }
    }), 201


@app.route("/api/media/<filename>")
@login_required
def api_serve_media(user, filename):
    # Prevent directory traversal
    safe = os.path.basename(filename)
    if safe != filename or ".." in filename:
        return "", 403
    filepath = os.path.join(MEDIA_DIR, safe)
    if not os.path.isfile(filepath):
        return "", 404
    return send_file(filepath)


@app.route("/api/memories/<int:memory_id>/media/<int:media_id>", methods=["DELETE"])
@login_required
def api_delete_media(user, memory_id, media_id):
    fn = delete_memory_media(media_id, user["id"])
    if not fn:
        return jsonify({"error": "Media not found"}), 404
    path = os.path.join(MEDIA_DIR, fn)
    if os.path.isfile(path):
        os.remove(path)
    return jsonify({"ok": True})


# --- Backup API (Admin only) ---

@app.route("/api/backups/settings")
@admin_required
def api_backup_settings(user):
    settings = get_backup_settings()
    return jsonify({"settings": settings})


@app.route("/api/backups/settings", methods=["PUT"])
@admin_required
def api_update_backup_settings(user):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    settings = update_backup_settings(
        schedule=data.get("schedule"),
        max_backups=data.get("max_backups"),
        retention_days=data.get("retention_days"),
    )
    return jsonify({"settings": settings})


@app.route("/api/backups")
@admin_required
def api_list_backups(user):
    backups = list_backups()
    return jsonify({"backups": backups})


@app.route("/api/backups", methods=["POST"])
@admin_required
def api_create_backup(user):
    try:
        filename = create_backup(label="manual")
        return jsonify({"filename": filename, "ok": True}), 201
    except Exception as e:
        logger.error(f"Backup creation failed: {e}", exc_info=True)
        return jsonify({"error": f"Backup failed: {str(e)}"}), 500


@app.route("/api/backups/<filename>/download")
@admin_required
def api_download_backup(user, filename):
    path = get_backup_path(filename)
    if not path:
        return jsonify({"error": "Backup not found"}), 404
    return send_file(path, as_attachment=True, download_name=filename)


@app.route("/api/backups/upload", methods=["POST"])
@admin_required
def api_upload_backup(user):
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    if not f.filename or not f.filename.endswith(".zip"):
        return jsonify({"error": "Please upload a .zip backup file"}), 400
    try:
        filename, meta = save_uploaded_backup(f)
        return jsonify({"filename": filename, "meta": meta, "ok": True}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/backups/<filename>/restore", methods=["POST"])
@admin_required
def api_restore_backup(user, filename):
    path = get_backup_path(filename)
    if not path:
        return jsonify({"error": "Backup not found"}), 404
    try:
        logger.info(f"AUDIT: Admin '{user['username']}' restoring backup '{filename}'")
        meta = restore_backup(path)
        # Re-initialize auth DB to pick up any schema migrations
        init_auth_db()
        logger.info(f"AUDIT: Backup restored successfully by '{user['username']}'")
        return jsonify({"ok": True, "meta": meta})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Restore failed: {e}", exc_info=True)
        return jsonify({"error": f"Restore failed: {str(e)}"}), 500


@app.route("/api/backups/<filename>", methods=["DELETE"])
@admin_required
def api_delete_backup(user, filename):
    if remove_backup(filename):
        return jsonify({"ok": True})
    return jsonify({"error": "Backup not found"}), 404


@app.route("/api/sync", methods=["POST"])
@admin_required
def api_sync(user):
    if sync_status["running"]:
        return jsonify({"status": "already_running", "message": sync_status["message"]})

    def run_sync():
        sync_status["running"] = True
        sync_status["progress"] = 0
        sync_status["errors"] = []
        try:
            def progress(msg):
                sync_status["message"] = msg
                logger.info(msg)

            # 1. Overpass sync (OSM landscape data)
            places = sync_places(progress_callback=progress)

            # 2. Natural England + NatureScot designations
            progress("Fetching official designation data...")
            designation_places = sync_designations(progress_callback=progress)
            places.extend(designation_places)

            # 3. Enrich with images from Wikipedia/Wikidata
            sync_status["message"] = "Resolving images from Wikipedia/Wikidata..."
            enrich_images(places, progress_callback=progress)

            # 3b. Fetch rich descriptions from Wikipedia
            fetch_wikipedia_extracts(places, progress_callback=progress)

            # 4. Save all places
            sync_status["message"] = f"Saving {len(places)} places..."
            for i, place in enumerate(places):
                upsert_place(place)
                if i % 100 == 0:
                    sync_status["progress"] = int((i / max(len(places), 1)) * 80)

            # 4b. Enrich DB descriptions (places with wiki links but missing descriptions)
            progress("Enriching descriptions from Wikipedia...")
            enrich_db_descriptions(progress_callback=progress)

            # 5. Reverse geocode ALL places missing county/city (in batches)
            progress("Reverse geocoding locations...")
            batch_num = 0
            while True:
                missing = get_places_missing_location(limit=GEOCODE_BATCH_SIZE)
                if not missing:
                    break
                batch_num += 1
                progress(f"Reverse geocoding batch {batch_num} ({len(missing)} places)...")
                geo_results = batch_reverse_geocode(missing, progress_callback=progress)
                for place_id, county, city, region, address in geo_results:
                    update_place_location(place_id, county, city, region, address)
                # Rename coordinate-placeholder names using geocoded location
                from models import get_db as _get_db
                conn2 = _get_db()
                for place_id, county, city, region, address in geo_results:
                    row = conn2.execute(
                        "SELECT name, category FROM places WHERE id = ?", (place_id,)
                    ).fetchone()
                    if row and " at " in row["name"] and "." in row["name"]:
                        locality = city or county or ""
                        if locality:
                            cat_label = row["category"].replace("_", " ").title()
                            conn2.execute(
                                "UPDATE places SET name = ? WHERE id = ?",
                                (f"{locality} {cat_label}", place_id),
                            )
                conn2.commit()
                conn2.close()
                # If we got no geocoding results, avoid infinite loop
                if not geo_results:
                    break

            # 6. Auto-feature places (prefer images + high hidden_score)
            from models import get_db
            conn = get_db()
            conn.execute("UPDATE places SET featured = 0")
            conn.execute("""
                UPDATE places SET featured = 1
                WHERE id IN (
                    SELECT id FROM places
                    WHERE image_url != '' AND name != ''
                    ORDER BY
                        hidden_score DESC,
                        CASE WHEN wikipedia != '' THEN 0 ELSE 1 END,
                        RANDOM()
                    LIMIT 30
                )
            """)
            conn.commit()
            conn.close()

            sync_status["message"] = f"Sync complete: {len(places)} places indexed"
            sync_status["progress"] = 100
        except Exception as e:
            sync_status["message"] = f"Sync error: {str(e)}"
            sync_status["errors"].append(str(e))
            logger.error(f"Sync failed: {e}", exc_info=True)
        finally:
            sync_status["running"] = False

    thread = threading.Thread(target=run_sync, daemon=True)
    thread.start()
    return jsonify({"status": "started"})


@app.route("/api/geocode", methods=["POST"])
@admin_required
def api_geocode(user):
    """Standalone geocoding — processes all places missing address info."""
    if sync_status["running"]:
        return jsonify({"status": "busy", "message": "A sync is already running"})

    def run_geocode():
        sync_status["running"] = True
        sync_status["progress"] = 0
        try:
            def progress(msg):
                sync_status["message"] = msg
                logger.info(msg)

            batch_num = 0
            total_geocoded = 0
            while True:
                missing = get_places_missing_location(limit=GEOCODE_BATCH_SIZE)
                if not missing:
                    break
                batch_num += 1
                progress(f"Geocoding batch {batch_num} ({len(missing)} places)...")
                geo_results = batch_reverse_geocode(missing, progress_callback=progress)
                for place_id, county, city, region, address in geo_results:
                    update_place_location(place_id, county, city, region, address)
                # Rename coordinate-placeholder names
                from models import get_db as _get_db
                conn2 = _get_db()
                for place_id, county, city, region, address in geo_results:
                    row = conn2.execute(
                        "SELECT name, category FROM places WHERE id = ?", (place_id,)
                    ).fetchone()
                    if row and " at " in row["name"] and "." in row["name"]:
                        locality = city or county or ""
                        if locality:
                            cat_label = row["category"].replace("_", " ").title()
                            conn2.execute(
                                "UPDATE places SET name = ? WHERE id = ?",
                                (f"{locality} {cat_label}", place_id),
                            )
                conn2.commit()
                conn2.close()
                total_geocoded += len(geo_results)
                if not geo_results:
                    break

            sync_status["message"] = f"Geocoding complete: {total_geocoded} places enriched"
            sync_status["progress"] = 100
        except Exception as e:
            sync_status["message"] = f"Geocode error: {str(e)}"
            logger.error(f"Geocoding failed: {e}", exc_info=True)
        finally:
            sync_status["running"] = False

    thread = threading.Thread(target=run_geocode, daemon=True)
    thread.start()
    return jsonify({"status": "started"})


@app.route("/api/sync/status")
def api_sync_status():
    return jsonify(sync_status)


@app.route("/api/stats")
def api_stats():
    return jsonify({"total_places": get_place_count()})


# --- Static File Serving ---

@app.route("/")
@app.route("/explore")
@app.route("/saved")
@app.route("/memories")
@app.route("/place/<int:place_id>")
@app.route("/profile")
@app.route("/settings")
@app.route("/login")
def serve_spa(**kwargs):
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/assets/logo.png")
def serve_logo():
    if os.path.exists(LOGO_PATH):
        return send_file(LOGO_PATH, mimetype="image/png")
    return "", 404


@app.route("/<path:path>")
def serve_static(path):
    # Prevent directory traversal
    safe_path = os.path.normpath(path)
    if safe_path.startswith("..") or safe_path.startswith("/"):
        return "", 403
    full_path = os.path.join(STATIC_DIR, safe_path)
    if os.path.isfile(full_path):
        return send_from_directory(STATIC_DIR, safe_path)
    return send_from_directory(STATIC_DIR, "index.html")


# --- Security Headers ---

@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # Content Security Policy
    csp = "; ".join([
        "default-src 'self'",
        "script-src 'self' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://api.qrserver.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
        "connect-src 'self' https://nominatim.openstreetmap.org",
        "media-src 'self' blob:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ])
    response.headers["Content-Security-Policy"] = csp

    # Permissions Policy — disable unused browser features
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), ambient-light-sensor=(), autoplay=(), "
        "battery=(), camera=(self), display-capture=(), "
        "geolocation=(self), gyroscope=(), magnetometer=(), "
        "microphone=(), midi=(), payment=(), usb=()"
    )

    # HSTS — only when behind HTTPS (detected by X-Forwarded-Proto)
    if request.headers.get("X-Forwarded-Proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response


# --- Initialize ---

if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    init_db()
    init_auth_db()
    start_backup_scheduler()
    logger.info(f"Quiet Isles starting on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
