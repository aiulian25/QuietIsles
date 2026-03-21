import time
import json
import logging
import requests
from config import OVERPASS_URL, UK_BBOX, PLACE_CATEGORIES, OSM_USER_AGENT, SYNC_DELAY_SECONDS

logger = logging.getLogger(__name__)


def build_overpass_query(tag, bbox=None, limit=500):
    """Build an Overpass QL query for a given OSM tag within the UK bounding box."""
    if bbox is None:
        bbox = UK_BBOX

    key, value = tag.split("=")
    bb = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"

    return f"""
[out:json][timeout:90];
(
  node["{key}"="{value}"]({bb});
  way["{key}"="{value}"]({bb});
  relation["{key}"="{value}"]({bb});
);
out center tags {limit};
"""


def query_overpass(query, max_retries=3):
    """Execute an Overpass API query with retry on 429/timeout."""
    headers = {"User-Agent": OSM_USER_AGENT}
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                OVERPASS_URL,
                data={"data": query},
                headers=headers,
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("elements", [])
        except requests.exceptions.HTTPError as e:
            if resp.status_code == 429 and attempt < max_retries - 1:
                wait = 15 * (attempt + 1)
                logger.warning(f"Overpass 429 rate limit, waiting {wait}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue
            logger.error(f"Overpass query failed: {e}")
            return []
        except requests.exceptions.ReadTimeout:
            if attempt < max_retries - 1:
                wait = 20 * (attempt + 1)
                logger.warning(f"Overpass timeout, retrying in {wait}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue
            logger.error("Overpass query timed out after all retries")
            return []
        except requests.exceptions.RequestException as e:
            logger.error(f"Overpass query failed: {e}")
            return []
    return []


def _calculate_hidden_score(tags, category):
    """
    Score 0.0 (well-known) to 1.0 (truly hidden gem).
    Based on tag sparsity, lack of Wikipedia/Wikidata, and category rarity.
    """
    score = 0.5  # start neutral

    # No Wikipedia/Wikidata = less documented = more hidden
    if not tags.get("wikipedia"):
        score += 0.15
    if not tags.get("wikidata"):
        score += 0.1

    # No website = less commercial / less known
    if not tags.get("website"):
        score += 0.05

    # Fewer total tags = less documented
    tag_count = len(tags)
    if tag_count <= 5:
        score += 0.1
    elif tag_count <= 10:
        score += 0.05

    # Rarer categories score higher
    rare_categories = {"waterfall", "cliff", "heath", "moor"}
    common_categories = {"national_park", "peak"}
    if category in rare_categories:
        score += 0.1
    elif category in common_categories:
        score -= 0.15

    return round(min(1.0, max(0.0, score)), 2)


def parse_element(element, category, allow_unnamed=False):
    """Parse an Overpass element into a place dict."""
    tags = element.get("tags", {})
    name = tags.get("name", "").strip()

    if not name and not allow_unnamed:
        return None

    # Get coordinates (center for ways/relations)
    if element["type"] == "node":
        lat = element.get("lat")
        lon = element.get("lon")
    else:
        center = element.get("center", {})
        lat = center.get("lat")
        lon = center.get("lon")

    if lat is None or lon is None:
        return None

    # Generate name for unnamed features from locality context
    if not name:
        locality = (
            tags.get("addr:locality", "")
            or tags.get("addr:suburb", "")
            or tags.get("addr:city", "")
            or tags.get("addr:hamlet", "")
            or tags.get("is_in", "").split(",")[0].strip()
        )
        surface = tags.get("surface", "")
        cat_label = category.replace("_", " ").title()
        if locality:
            name = f"{locality} {cat_label}"
        else:
            # Use coordinate-based placeholder — will be enriched by reverse geocoding
            name = f"{cat_label} at {lat:.3f}, {lon:.3f}"

    # Build description from available tags
    desc_parts = []
    if tags.get("description"):
        desc_parts.append(tags["description"])
    if tags.get("note"):
        desc_parts.append(tags["note"])

    # Get elevation for peaks
    elevation = tags.get("ele", "")

    # Get image URL if available
    image_url = tags.get("image", "")
    if not image_url:
        image_url = tags.get("wikimedia_commons", "")
    # Filter out non-image URLs (geograph HTML pages, categories, etc.)
    if image_url:
        lower = image_url.lower()
        if ("geograph.org" in lower or
                lower.startswith("category:") or
                (not any(lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")) and
                 "upload.wikimedia.org" not in lower)):
            image_url = ""

    # Region from addr or place context
    region = tags.get("is_in", "")
    if not region:
        region = tags.get("addr:county", "")
    if not region:
        region = tags.get("is_in:county", "")

    return {
        "osm_id": f"{element['type']}/{element['id']}",
        "name": name,
        "category": category,
        "lat": lat,
        "lon": lon,
        "description": " ".join(desc_parts),
        "elevation": str(elevation),
        "image_url": image_url,
        "wikidata": tags.get("wikidata", ""),
        "wikipedia": tags.get("wikipedia", ""),
        "tags": json.dumps({k: v for k, v in tags.items()
                           if k in ("access", "fee", "opening_hours", "website",
                                    "phone", "operator", "surface", "trail_visibility")}),
        "region": region,
        "hidden_score": _calculate_hidden_score(tags, category),
    }


def sync_places(progress_callback=None):
    """Fetch places from Overpass API for all categories and return them."""
    all_places = []
    total = len(PLACE_CATEGORIES)

    for idx, (category, info) in enumerate(PLACE_CATEGORIES.items()):
        if progress_callback:
            progress_callback(f"Fetching {info['label']}... ({idx + 1}/{total})")

        allow_unnamed = info.get("allow_unnamed", False)
        limit = 1000 if allow_unnamed else 500

        logger.info(f"Querying Overpass for {category} ({info['tag']})")
        query = build_overpass_query(info["tag"], limit=limit)
        elements = query_overpass(query)
        logger.info(f"Got {len(elements)} elements for {category}")

        for el in elements:
            place = parse_element(el, category, allow_unnamed=allow_unnamed)
            if place:
                all_places.append(place)

        # Rate limit
        if idx < total - 1:
            time.sleep(SYNC_DELAY_SECONDS)

    return all_places
