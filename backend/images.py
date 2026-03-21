"""Resolve place images from Wikipedia, Wikidata, and Wikimedia Commons."""

import logging
import time
import re
import hashlib
import requests
from config import OSM_USER_AGENT

logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
THUMB_WIDTH = 800
REQUEST_DELAY = 0.1  # seconds between API calls


def _session():
    s = requests.Session()
    s.headers["User-Agent"] = OSM_USER_AGENT
    s.timeout = 15
    return s


def _commons_thumb_url(filename, width=THUMB_WIDTH):
    """Convert a Wikimedia Commons filename to a direct thumbnail URL."""
    filename = filename.replace(" ", "_")
    if filename.startswith("File:"):
        filename = filename[5:]
    md5 = hashlib.md5(filename.encode()).hexdigest()
    encoded = requests.utils.quote(filename)
    return (
        f"https://upload.wikimedia.org/wikipedia/commons/thumb/"
        f"{md5[0]}/{md5[:2]}/{encoded}/{width}px-{encoded}"
    )


def image_from_wikipedia(title, sess=None):
    """Get a page image thumbnail from Wikipedia via the pageimages API."""
    if not title:
        return ""
    # Handle "en:Article_Name" format
    if ":" in title and len(title.split(":")[0]) <= 3:
        title = title.split(":", 1)[1]

    sess = sess or _session()
    try:
        resp = sess.get(WIKIPEDIA_API, params={
            "action": "query",
            "titles": title,
            "prop": "pageimages",
            "format": "json",
            "pithumbsize": THUMB_WIDTH,
            "pilicense": "any",
        })
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            thumb = page.get("thumbnail", {}).get("source", "")
            if thumb:
                return thumb
    except Exception as e:
        logger.debug(f"Wikipedia image lookup failed for '{title}': {e}")
    return ""


def image_from_wikidata(qid, sess=None):
    """Get an image URL from a Wikidata entity's P18 (image) property."""
    if not qid:
        return ""
    sess = sess or _session()
    try:
        resp = sess.get(WIKIDATA_API, params={
            "action": "wbgetclaims",
            "entity": qid,
            "property": "P18",
            "format": "json",
        })
        resp.raise_for_status()
        claims = resp.json().get("claims", {}).get("P18", [])
        if claims:
            filename = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", "")
            if filename:
                return _commons_thumb_url(filename)
    except Exception as e:
        logger.debug(f"Wikidata image lookup failed for '{qid}': {e}")
    return ""


def image_from_commons_tag(tag_value):
    """Resolve a wikimedia_commons tag value (e.g., 'File:Example.jpg') to a thumb URL."""
    if not tag_value:
        return ""
    if tag_value.startswith("File:") or tag_value.startswith("Image:"):
        return _commons_thumb_url(tag_value)
    if tag_value.startswith("Category:"):
        return ""  # Can't resolve category to a single image easily
    return ""


def fetch_wikipedia_extracts(places_data, progress_callback=None):
    """
    Enrich places that have wikipedia/wikidata tags but short/empty descriptions
    with the opening paragraph from Wikipedia.
    """
    MIN_DESC_LENGTH = 80  # Only fetch if existing description is shorter than this
    enriched = 0

    # Collect places needing description enrichment
    needs_desc = {}
    wikidata_lookup = {}  # qid -> index for places with wikidata but no wikipedia
    for i, place in enumerate(places_data):
        desc = place.get("description", "")
        wp = place.get("wikipedia", "")
        wd = place.get("wikidata", "")
        if wp and len(desc) < MIN_DESC_LENGTH:
            title = wp.split(":", 1)[1] if ":" in wp and len(wp.split(":")[0]) <= 3 else wp
            needs_desc[title] = i
        elif wd and not wp and len(desc) < MIN_DESC_LENGTH:
            wikidata_lookup[wd] = i

    # Resolve Wikidata IDs to Wikipedia titles via sitelinks
    if wikidata_lookup:
        sess_wd = _session()
        qids_list = list(wikidata_lookup.keys())
        for batch_start in range(0, len(qids_list), 50):
            batch = qids_list[batch_start:batch_start + 50]
            try:
                resp = sess_wd.get(WIKIDATA_API, params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "sitelinks",
                    "sitefilter": "enwiki",
                    "format": "json",
                })
                resp.raise_for_status()
                entities = resp.json().get("entities", {})
                for qid, entity in entities.items():
                    sitelinks = entity.get("sitelinks", {})
                    enwiki = sitelinks.get("enwiki", {})
                    title = enwiki.get("title", "")
                    if title and qid in wikidata_lookup:
                        needs_desc[title] = wikidata_lookup[qid]
            except Exception as e:
                logger.warning(f"Wikidata sitelink batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)

    if not needs_desc:
        return 0

    sess = _session()
    titles_list = list(needs_desc.keys())

    for batch_start in range(0, len(titles_list), 20):
        batch = titles_list[batch_start:batch_start + 20]
        if progress_callback:
            progress_callback(f"Fetching Wikipedia descriptions... ({batch_start}/{len(titles_list)})")
        try:
            resp = sess.get(WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(batch),
                "prop": "extracts",
                "format": "json",
                "exintro": True,
                "explaintext": True,
                "exsentences": 5,
            })
            resp.raise_for_status()
            pages = resp.json().get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title", "")
                extract = page.get("extract", "").strip()
                if extract and title in needs_desc:
                    idx = needs_desc[title]
                    # Only replace if the extract is meaningfully longer
                    if len(extract) > len(places_data[idx].get("description", "")):
                        places_data[idx]["description"] = extract
                        enriched += 1
        except Exception as e:
            logger.warning(f"Wikipedia extract batch failed: {e}")
        time.sleep(REQUEST_DELAY * 2)

    if progress_callback:
        progress_callback(f"Description enrichment complete: {enriched} descriptions fetched")

    return enriched


def enrich_db_descriptions(progress_callback=None):
    """
    Fetch Wikipedia descriptions for DB records that have wikipedia/wikidata
    links but short/empty descriptions. Operates directly on the database.
    """
    from models import get_db
    conn = get_db()
    MIN_DESC_LENGTH = 80

    # Get places needing description enrichment
    rows = conn.execute("""
        SELECT id, wikipedia, wikidata, description FROM places
        WHERE (wikipedia != '' OR wikidata != '')
        AND (description = '' OR length(description) < ?)
    """, (MIN_DESC_LENGTH,)).fetchall()

    if not rows:
        conn.close()
        return 0

    # Build title-to-id mapping
    needs_desc = {}  # title -> place_id
    wikidata_lookup = {}  # qid -> place_id

    for row in rows:
        wp = row[1]
        wd = row[2]
        pid = row[0]
        if wp:
            title = wp.split(":", 1)[1] if ":" in wp and len(wp.split(":")[0]) <= 3 else wp
            needs_desc[title] = pid
        elif wd:
            wikidata_lookup[wd] = pid

    # Resolve Wikidata IDs to Wikipedia titles
    if wikidata_lookup:
        sess = _session()
        qids = list(wikidata_lookup.keys())
        for batch_start in range(0, len(qids), 50):
            batch = qids[batch_start:batch_start + 50]
            try:
                resp = sess.get(WIKIDATA_API, params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "sitelinks",
                    "sitefilter": "enwiki",
                    "format": "json",
                })
                resp.raise_for_status()
                entities = resp.json().get("entities", {})
                for qid, entity in entities.items():
                    title = entity.get("sitelinks", {}).get("enwiki", {}).get("title", "")
                    if title and qid in wikidata_lookup:
                        needs_desc[title] = wikidata_lookup[qid]
            except Exception as e:
                logger.warning(f"Wikidata sitelink batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)

    if not needs_desc:
        conn.close()
        return 0

    # Fetch Wikipedia extracts and update DB
    sess = _session()
    enriched = 0
    titles_list = list(needs_desc.keys())

    for batch_start in range(0, len(titles_list), 20):
        batch = titles_list[batch_start:batch_start + 20]
        if progress_callback:
            progress_callback(f"Enriching descriptions... ({batch_start}/{len(titles_list)})")
        try:
            resp = sess.get(WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(batch),
                "prop": "extracts",
                "format": "json",
                "exintro": True,
                "explaintext": True,
                "exsentences": 5,
            })
            resp.raise_for_status()
            pages = resp.json().get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title", "")
                extract = page.get("extract", "").strip()
                if extract and title in needs_desc:
                    place_id = needs_desc[title]
                    conn.execute(
                        "UPDATE places SET description = ? WHERE id = ? AND length(description) < ?",
                        (extract, place_id, len(extract)),
                    )
                    enriched += 1
        except Exception as e:
            logger.warning(f"Wikipedia extract batch failed: {e}")
        time.sleep(REQUEST_DELAY * 2)

    conn.commit()
    conn.close()

    if progress_callback:
        progress_callback(f"DB description enrichment: {enriched} descriptions updated")

    return enriched


def is_valid_image_url(url):
    """Check if a URL looks like it points to an actual image file."""
    if not url:
        return False
    lower = url.lower().split("?")[0]
    # Reject known non-image URLs
    if "geograph.org" in lower:
        return False
    if lower.startswith("category:") or lower.startswith("file:"):
        return False
    image_extensions = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")
    # Direct image URLs, Wikipedia/Commons thumbnails
    if any(lower.endswith(ext) for ext in image_extensions):
        return True
    if "upload.wikimedia.org" in lower:
        return True
    if "commons.wikimedia.org" in lower and "/thumb/" in lower:
        return True
    return False


def resolve_place_image(place):
    """Try to resolve a usable image URL for a place. Returns image URL or empty string."""
    # 1. Already has a valid direct image URL
    if is_valid_image_url(place.get("image_url", "")):
        return place["image_url"]

    sess = _session()

    # 2. wikimedia_commons tag
    raw_img = place.get("image_url", "")
    if raw_img and ("wikimedia" in raw_img.lower() or raw_img.startswith("File:")):
        url = image_from_commons_tag(raw_img)
        if url:
            return url

    # 3. Wikipedia article
    wikipedia = place.get("wikipedia", "")
    if wikipedia:
        url = image_from_wikipedia(wikipedia, sess)
        if url:
            time.sleep(REQUEST_DELAY)
            return url

    # 4. Wikidata entity
    wikidata = place.get("wikidata", "")
    if wikidata:
        url = image_from_wikidata(wikidata, sess)
        if url:
            time.sleep(REQUEST_DELAY)
            return url

    return ""


def enrich_images(places_data, progress_callback=None):
    """
    Enrich a list of place dicts with resolved image URLs.
    Only processes places that don't already have valid image URLs.
    Returns count of newly resolved images.
    """
    resolved = 0
    total = len(places_data)

    # Batch Wikipedia lookups (up to 50 titles per request)
    wiki_batch = {}
    for i, place in enumerate(places_data):
        if is_valid_image_url(place.get("image_url", "")):
            continue
        wp = place.get("wikipedia", "")
        if wp:
            title = wp.split(":", 1)[1] if ":" in wp and len(wp.split(":")[0]) <= 3 else wp
            wiki_batch[title] = i

    # Process Wikipedia in batches of 50
    sess = _session()
    titles_list = list(wiki_batch.keys())
    for batch_start in range(0, len(titles_list), 50):
        batch = titles_list[batch_start:batch_start + 50]
        if progress_callback:
            progress_callback(f"Fetching Wikipedia images... ({batch_start}/{len(titles_list)})")
        try:
            resp = sess.get(WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(batch),
                "prop": "pageimages",
                "format": "json",
                "pithumbsize": THUMB_WIDTH,
                "pilicense": "any",
            })
            resp.raise_for_status()
            pages = resp.json().get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title", "")
                thumb = page.get("thumbnail", {}).get("source", "")
                if thumb and title in wiki_batch:
                    idx = wiki_batch[title]
                    places_data[idx]["image_url"] = thumb
                    resolved += 1
        except Exception as e:
            logger.warning(f"Wikipedia batch failed: {e}")
        time.sleep(REQUEST_DELAY * 2)

    # Process remaining via Wikidata (one by one, with rate limiting)
    for i, place in enumerate(places_data):
        if is_valid_image_url(place.get("image_url", "")):
            continue
        qid = place.get("wikidata", "")
        if qid:
            if progress_callback and i % 20 == 0:
                progress_callback(f"Fetching Wikidata images... ({i}/{total})")
            url = image_from_wikidata(qid, sess)
            if url:
                place["image_url"] = url
                resolved += 1
            time.sleep(REQUEST_DELAY)

    if progress_callback:
        progress_callback(f"Image enrichment complete: {resolved} images resolved")

    return resolved
