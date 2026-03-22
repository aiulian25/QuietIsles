import sqlite3
import os
from config import DB_PATH, DATA_DIR


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            osm_id TEXT UNIQUE,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            description TEXT DEFAULT '',
            elevation TEXT DEFAULT '',
            image_url TEXT DEFAULT '',
            wikidata TEXT DEFAULT '',
            wikipedia TEXT DEFAULT '',
            tags TEXT DEFAULT '{}',
            region TEXT DEFAULT '',
            county TEXT DEFAULT '',
            city TEXT DEFAULT '',
            designation TEXT DEFAULT '',
            hidden_score REAL DEFAULT 0.0,
            address TEXT DEFAULT '',
            difficulty TEXT DEFAULT '',
            duration TEXT DEFAULT '',
            distance_km TEXT DEFAULT '',
            featured INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
        CREATE INDEX IF NOT EXISTS idx_places_lat_lon ON places(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_places_featured ON places(featured);
        CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);

        CREATE TABLE IF NOT EXISTS saved_places (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            place_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (place_id) REFERENCES places(id),
            UNIQUE(session_id, place_id)
        );

        CREATE INDEX IF NOT EXISTS idx_saved_session ON saved_places(session_id);
    """)
    # Add new columns if missing (migration for existing DBs)
    for col, default in [("county", "''"), ("city", "''"), ("designation", "''"), ("hidden_score", "0.0"), ("address", "''")]:
        try:
            conn.execute(f"ALTER TABLE places ADD COLUMN {col} TEXT DEFAULT {default}")
        except sqlite3.OperationalError:
            pass  # column already exists
    # Create indexes on new columns (after migration ensures they exist)
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_places_hidden ON places(hidden_score)",
        "CREATE INDEX IF NOT EXISTS idx_places_county ON places(county)",
    ]:
        try:
            conn.execute(idx_sql)
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()


def get_places(lat=None, lon=None, radius_km=50, category=None, page=1, per_page=20, search=None):
    conn = get_db()
    params = []
    conditions = []

    if category and category != "all":
        conditions.append("category = ?")
        params.append(category)

    if search:
        conditions.append("(name LIKE ? OR county LIKE ? OR city LIKE ? OR region LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%", f"%{search}%"])

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    # If location provided, calculate distance and sort by it
    if lat is not None and lon is not None:
        # Haversine approximation in SQL
        query = f"""
            SELECT *,
                (6371 * acos(
                    min(1.0, cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?))
                    + sin(radians(?)) * sin(radians(lat)))
                )) AS distance_from_user
            FROM places
            {where}
            {"AND" if where else "WHERE"} (6371 * acos(
                min(1.0, cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?))
                + sin(radians(?)) * sin(radians(lat)))
            )) <= ?
            ORDER BY distance_from_user ASC
            LIMIT ? OFFSET ?
        """
        location_params = [lat, lon, lat, lat, lon, lat, radius_km]
        params = location_params[:3] + params + location_params[3:] + [per_page, (page - 1) * per_page]
    else:
        query = f"""
            SELECT *, NULL AS distance_from_user
            FROM places
            {where}
            ORDER BY featured DESC, name ASC
            LIMIT ? OFFSET ?
        """
        params.extend([per_page, (page - 1) * per_page])

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_place_by_id(place_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_featured_places(limit=5):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM places WHERE featured = 1 ORDER BY RANDOM() LIMIT ?",
        (limit,)
    ).fetchall()
    if not rows:
        rows = conn.execute(
            "SELECT * FROM places WHERE name != '' ORDER BY RANDOM() LIMIT ?",
            (limit,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_place_count():
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
    conn.close()
    return count


def upsert_place(place_data):
    conn = get_db()
    conn.execute("""
        INSERT INTO places (osm_id, name, category, lat, lon, description, elevation,
                           image_url, wikidata, wikipedia, tags, region, county, city,
                           designation, hidden_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(osm_id) DO UPDATE SET
            name=excluded.name, category=excluded.category,
            lat=excluded.lat, lon=excluded.lon,
            description=CASE WHEN length(excluded.description) > length(places.description) THEN excluded.description ELSE places.description END,
            elevation=excluded.elevation,
            image_url=CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE places.image_url END,
            wikidata=excluded.wikidata,
            wikipedia=excluded.wikipedia, tags=excluded.tags,
            region=CASE WHEN excluded.region != '' THEN excluded.region ELSE places.region END,
            county=CASE WHEN excluded.county != '' THEN excluded.county ELSE places.county END,
            city=CASE WHEN excluded.city != '' THEN excluded.city ELSE places.city END,
            designation=CASE WHEN excluded.designation != '' THEN excluded.designation ELSE places.designation END,
            hidden_score=excluded.hidden_score
    """, (
        place_data["osm_id"], place_data["name"], place_data["category"],
        place_data["lat"], place_data["lon"],
        place_data.get("description", ""),
        place_data.get("elevation", ""),
        place_data.get("image_url", ""),
        place_data.get("wikidata", ""),
        place_data.get("wikipedia", ""),
        place_data.get("tags", "{}"),
        place_data.get("region", ""),
        place_data.get("county", ""),
        place_data.get("city", ""),
        place_data.get("designation", ""),
        place_data.get("hidden_score", 0.0),
    ))
    conn.commit()
    conn.close()


def update_place_location(place_id, county="", city="", region="", address=""):
    """Update location info for a place (from reverse geocoding)."""
    conn = get_db()
    sets = ["address = ?"]
    params = [address or "-"]
    if county:
        sets.append("county = ?")
        params.append(county)
    if city:
        sets.append("city = ?")
        params.append(city)
    if region:
        sets.append("region = ?")
        params.append(region)
    params.append(place_id)
    conn.execute(f"UPDATE places SET {', '.join(sets)} WHERE id = ?", params)
    conn.commit()
    conn.close()


def get_places_missing_location(limit=100):
    """Get places that need reverse geocoding (no address)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, lat, lon, name FROM places WHERE address = '' AND lat != 0 LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_saved_places(session_id):
    conn = get_db()
    rows = conn.execute("""
        SELECT p.*, sp.created_at as saved_at
        FROM saved_places sp
        JOIN places p ON sp.place_id = p.id
        WHERE sp.session_id = ?
        ORDER BY sp.created_at DESC
    """, (session_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_place(session_id, place_id):
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO saved_places (session_id, place_id) VALUES (?, ?)",
            (session_id, place_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def unsave_place(session_id, place_id):
    conn = get_db()
    try:
        conn.execute(
            "DELETE FROM saved_places WHERE session_id = ? AND place_id = ?",
            (session_id, place_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def is_place_saved(session_id, place_id):
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM saved_places WHERE session_id = ? AND place_id = ?",
        (session_id, place_id)
    ).fetchone()
    conn.close()
    return row is not None


def set_featured(place_ids):
    conn = get_db()
    conn.execute("UPDATE places SET featured = 0")
    if place_ids:
        placeholders = ",".join("?" * len(place_ids))
        conn.execute(f"UPDATE places SET featured = 1 WHERE id IN ({placeholders})", place_ids)
    conn.commit()
    conn.close()


def get_categories_with_counts():
    conn = get_db()
    rows = conn.execute("""
        SELECT category, COUNT(*) as count
        FROM places
        GROUP BY category
        ORDER BY count DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]
