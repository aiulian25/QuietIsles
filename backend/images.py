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
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
THUMB_WIDTH = 800
REQUEST_DELAY = 0.5  # seconds between API calls
COMMONS_DELAY = 1.0  # slower for Commons to avoid rate limiting


def _session():
    s = requests.Session()
    s.headers["User-Agent"] = OSM_USER_AGENT
    s.headers["Api-User-Agent"] = OSM_USER_AGENT
    s.timeout = 30
    return s


def _api_get(sess, url, params, max_retries=5):
    """Make an API GET with retry on rate limiting."""
    for attempt in range(max_retries):
        try:
            resp = sess.get(url, params=params)
        except requests.exceptions.RequestException as e:
            logger.warning(f"Request error for {url}: {e}, retrying in {30*(attempt+1)}s")
            time.sleep(30 * (attempt + 1))
            continue
        if resp.status_code == 429 or "too many requests" in resp.text[:200].lower():
            wait = 30 * (attempt + 1)
            logger.warning(f"Rate limited by {url}, waiting {wait}s (attempt {attempt+1})")
            time.sleep(wait)
            continue
        return resp
    logger.error(f"Rate limited after {max_retries} retries on {url}, cooling down 120s")
    time.sleep(120)
    # One final attempt after long cooldown
    try:
        resp = sess.get(url, params=params)
        if resp.status_code != 429:
            return resp
    except requests.exceptions.RequestException:
        pass
    return None


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
        resp = _api_get(sess, WIKIPEDIA_API, params={
            "action": "query",
            "titles": title,
            "prop": "pageimages",
            "format": "json",
            "pithumbsize": THUMB_WIDTH,
            "pilicense": "any",
        })
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
        resp = _api_get(sess, WIKIDATA_API, params={
            "action": "wbgetclaims",
            "entity": qid,
            "property": "P18",
            "format": "json",
        })
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


def image_from_commons_search(name, category="", county="", sess=None):
    """
    Search Wikimedia Commons for an image matching a place name.
    Appends category/county for disambiguation.
    Returns thumbnail URL or empty string.
    """
    if not name:
        return ""
    query = name
    if county:
        query += f" {county}"
    elif category:
        label = category.replace("_", " ")
        query += f" {label}"

    sess = sess or _session()
    try:
        resp = _api_get(sess, COMMONS_API, params={
            "action": "query",
            "generator": "search",
            "gsrnamespace": 6,  # File namespace
            "gsrsearch": query,
            "gsrlimit": 1,
            "prop": "imageinfo",
            "iiprop": "url",
            "iiurlwidth": THUMB_WIDTH,
            "format": "json",
        })
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            info = page.get("imageinfo", [{}])[0]
            thumb = info.get("thumburl", "")
            if thumb:
                return thumb
    except Exception as e:
        logger.debug(f"Commons search failed for '{query}': {e}")
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
                resp = _api_get(sess_wd, WIKIDATA_API, params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "sitelinks",
                    "sitefilter": "enwiki",
                    "format": "json",
                })
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
            resp = _api_get(sess, WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(batch),
                "prop": "extracts",
                "format": "json",
                "exintro": True,
                "explaintext": True,
                "exsentences": 5,
            })
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
    Also generates basic descriptions for places with no wiki links.
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
                resp = _api_get(sess, WIKIDATA_API, params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "sitelinks",
                    "sitefilter": "enwiki",
                    "format": "json",
                })
                entities = resp.json().get("entities", {})
                for qid, entity in entities.items():
                    title = entity.get("sitelinks", {}).get("enwiki", {}).get("title", "")
                    if title and qid in wikidata_lookup:
                        needs_desc[title] = wikidata_lookup[qid]
            except Exception as e:
                logger.warning(f"Wikidata sitelink batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)

    if not needs_desc:
        wiki_enriched = 0
    else:
        # Fetch Wikipedia extracts and update DB
        sess = _session()
        wiki_enriched = 0
        titles_list = list(needs_desc.keys())

        for batch_start in range(0, len(titles_list), 20):
            batch = titles_list[batch_start:batch_start + 20]
            if progress_callback:
                progress_callback(f"Enriching descriptions... ({batch_start}/{len(titles_list)})")
            try:
                resp = _api_get(sess, WIKIPEDIA_API, params={
                    "action": "query",
                    "titles": "|".join(batch),
                    "prop": "extracts",
                    "format": "json",
                    "exintro": True,
                    "explaintext": True,
                    "exsentences": 5,
                })
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
                        wiki_enriched += 1
            except Exception as e:
                logger.warning(f"Wikipedia extract batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)

        conn.commit()

    # Generate descriptions for places with no wiki links and no description
    _CATEGORY_DESCRIPTIONS = {
        "beach": "A scenic beach along the coastline of {region}, offering sandy shores and coastal views.",
        "peak": "A notable summit in {region}, providing panoramic views of the surrounding landscape.",
        "nature_reserve": "A protected nature reserve in {region}, home to diverse wildlife and natural habitats.",
        "cliff": "A dramatic cliff formation in {region}, showcasing the rugged beauty of the coastline.",
        "moor": "An expansive moorland in {region}, characterized by open heathland and rolling terrain.",
        "waterfall": "A picturesque waterfall in {region}, where water cascades through the natural landscape.",
        "viewpoint": "A scenic viewpoint in {region}, offering sweeping views across the surrounding countryside.",
        "heath": "A heathland area in {region}, featuring open terrain with heather and native flora.",
        "national_park": "Part of a protected national park in {region}, preserving outstanding natural beauty.",
        "aonb": "Located within an Area of Outstanding Natural Beauty in {region}, recognised for its exceptional landscape.",
        "national_trail": "A section of a national trail in {region}, offering long-distance walking through beautiful scenery.",
    }

    no_desc_rows = conn.execute("""
        SELECT id, name, category, county, region FROM places
        WHERE (description = '' OR description IS NULL)
        AND name != '' AND name NOT LIKE '%% at %%'
    """).fetchall()

    generated = 0
    if no_desc_rows:
        if progress_callback:
            progress_callback(f"Generating descriptions for {len(no_desc_rows)} places...")
        for row in no_desc_rows:
            pid, name, category, county, region = row[0], row[1], row[2], row[3] or "", row[4] or ""
            location = county or region or "the United Kingdom"
            template = _CATEGORY_DESCRIPTIONS.get(category)
            if template:
                desc = f"{name}. {template.format(region=location)}"
                conn.execute("UPDATE places SET description = ? WHERE id = ?", (desc, pid))
                generated += 1
        conn.commit()

    conn.close()
    enriched = wiki_enriched + generated

    if progress_callback:
        progress_callback(f"Description enrichment: {wiki_enriched} from Wikipedia, {generated} generated")

    return enriched


def is_valid_image_url(url):
    """Check if a URL looks like it points to an actual image file."""
    if not url:
        return False
    lower = url.lower().split("?")[0]
    # Reject non-URL values
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
            resp = _api_get(sess, WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(batch),
                "prop": "pageimages",
                "format": "json",
                "pithumbsize": THUMB_WIDTH,
                "pilicense": "any",
            })
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

    # Search Wikipedia by name for places with no wiki links at all
    no_link = [
        (i, p) for i, p in enumerate(places_data)
        if not is_valid_image_url(p.get("image_url", ""))
        and not p.get("wikipedia") and not p.get("wikidata")
        and p.get("name") and " at " not in p["name"]
    ]
    if no_link and progress_callback:
        progress_callback(f"Searching Wikipedia images for {len(no_link)} unlinked places...")

    for batch_start in range(0, len(no_link), 50):
        batch = no_link[batch_start:batch_start + 50]
        if progress_callback:
            progress_callback(
                f"Wikipedia image search... ({batch_start}/{len(no_link)})"
            )
        titles = [p["name"] for _, p in batch]
        try:
            resp = _api_get(sess, WIKIPEDIA_API, params={
                "action": "query",
                "titles": "|".join(titles),
                "prop": "pageimages",
                "format": "json",
                "pithumbsize": THUMB_WIDTH,
                "pilicense": "any",
                "redirects": 1,
            })
            data = resp.json().get("query", {})
            pages = data.get("pages", {})
            # Build normalized-title -> thumb lookup (handles redirects)
            thumb_map = {}
            for page in pages.values():
                title = page.get("title", "")
                thumb = page.get("thumbnail", {}).get("source", "")
                if thumb:
                    thumb_map[title.lower()] = thumb
            # Also map from redirect sources
            for redir in data.get("redirects", []):
                target = redir.get("to", "").lower()
                source = redir.get("from", "").lower()
                if target in thumb_map:
                    thumb_map[source] = thumb_map[target]
            for norm in data.get("normalized", []):
                target = norm.get("to", "").lower()
                source = norm.get("from", "").lower()
                if target in thumb_map:
                    thumb_map[source] = thumb_map[target]

            for idx, place in batch:
                name_lower = place["name"].lower()
                if name_lower in thumb_map:
                    places_data[idx]["image_url"] = thumb_map[name_lower]
                    resolved += 1
        except Exception as e:
            logger.warning(f"Wikipedia name-search batch failed: {e}")
        time.sleep(REQUEST_DELAY * 2)

    # Stage 4: Wikimedia Commons search for remaining places without images
    no_image = [
        (i, p) for i, p in enumerate(places_data)
        if not is_valid_image_url(p.get("image_url", ""))
        and p.get("name") and " at " not in p["name"]
    ]
    if no_image and progress_callback:
        progress_callback(f"Searching Wikimedia Commons for {len(no_image)} places...")

    for j, (idx, place) in enumerate(no_image):
        if progress_callback and j % 50 == 0:
            progress_callback(f"Commons search... ({j}/{len(no_image)})")
        url = image_from_commons_search(
            place["name"],
            category=place.get("category", ""),
            county=place.get("county", ""),
            sess=sess,
        )
        if url:
            places_data[idx]["image_url"] = url
            resolved += 1
        time.sleep(COMMONS_DELAY)

    if progress_callback:
        progress_callback(f"Image enrichment complete: {resolved} images resolved")

    return resolved


def enrich_db_images(progress_callback=None):
    """
    Find DB places missing images and try to resolve them via Wikipedia name search.
    This covers places that were already saved but had no wiki links at sync time.
    """
    from models import get_db
    conn = get_db()

    # 1. Places with wikidata but no image
    wd_rows = conn.execute(
        "SELECT id, name, wikidata FROM places WHERE wikidata != '' AND image_url = ''"
    ).fetchall()

    sess = _session()
    resolved = 0

    if wd_rows:
        if progress_callback:
            progress_callback(f"Resolving images for {len(wd_rows)} Wikidata-linked places...")
        # Batch Wikidata lookups (50 entities per request)
        qid_to_id = {row[2]: row[0] for row in wd_rows}
        qids = list(qid_to_id.keys())
        for batch_start in range(0, len(qids), 50):
            batch = qids[batch_start:batch_start + 50]
            try:
                resp = _api_get(sess, WIKIDATA_API, params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch),
                    "props": "claims",
                    "format": "json",
                })
                if resp is None:
                    continue
                entities = resp.json().get("entities", {})
                for qid, entity in entities.items():
                    claims = entity.get("claims", {}).get("P18", [])
                    if claims:
                        filename = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value", "")
                        if filename:
                            url = _commons_thumb_url(filename)
                            conn.execute("UPDATE places SET image_url = ? WHERE id = ?", (url, qid_to_id[qid]))
                            resolved += 1
            except Exception as e:
                logger.warning(f"Wikidata batch image lookup failed: {e}")
            time.sleep(REQUEST_DELAY * 3)
        conn.commit()

    # 2. Places with wikipedia but no image
    wp_rows = conn.execute(
        "SELECT id, name, wikipedia FROM places WHERE wikipedia != '' AND image_url = '' LIMIT 500"
    ).fetchall()

    if wp_rows:
        titles_map = {}  # title -> place_id
        for row in wp_rows:
            wp = row[2]
            title = wp.split(":", 1)[1] if ":" in wp and len(wp.split(":")[0]) <= 3 else wp
            titles_map[title] = row[0]

        titles_list = list(titles_map.keys())
        for batch_start in range(0, len(titles_list), 50):
            batch = titles_list[batch_start:batch_start + 50]
            if progress_callback:
                progress_callback(f"Wikipedia image lookup... ({batch_start}/{len(titles_list)})")
            try:
                resp = _api_get(sess, WIKIPEDIA_API, params={
                    "action": "query",
                    "titles": "|".join(batch),
                    "prop": "pageimages",
                    "format": "json",
                    "pithumbsize": THUMB_WIDTH,
                    "pilicense": "any",
                })
                pages = resp.json().get("query", {}).get("pages", {})
                for page in pages.values():
                    title = page.get("title", "")
                    thumb = page.get("thumbnail", {}).get("source", "")
                    if thumb and title in titles_map:
                        conn.execute(
                            "UPDATE places SET image_url = ? WHERE id = ?",
                            (thumb, titles_map[title]),
                        )
                        resolved += 1
            except Exception as e:
                logger.warning(f"Wikipedia image batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)
        conn.commit()

    # 3. Places with no wiki links — search by name
    name_rows = conn.execute("""
        SELECT id, name FROM places
        WHERE image_url = '' AND wikipedia = '' AND wikidata = ''
        AND name != '' AND name NOT LIKE '%% at %%'
    """).fetchall()

    if name_rows:
        if progress_callback:
            progress_callback(f"Searching Wikipedia by name for {len(name_rows)} places...")
        for batch_start in range(0, len(name_rows), 50):
            batch = name_rows[batch_start:batch_start + 50]
            if progress_callback:
                progress_callback(f"Wikipedia name search... ({batch_start}/{len(name_rows)})")
            name_map = {row[1].lower(): row[0] for row in batch}
            titles = [row[1] for row in batch]
            try:
                resp = _api_get(sess, WIKIPEDIA_API, params={
                    "action": "query",
                    "titles": "|".join(titles),
                    "prop": "pageimages",
                    "format": "json",
                    "pithumbsize": THUMB_WIDTH,
                    "pilicense": "any",
                    "redirects": 1,
                })
                qdata = resp.json().get("query", {})
                pages = qdata.get("pages", {})
                thumb_map = {}
                for page in pages.values():
                    t = page.get("title", "")
                    thumb = page.get("thumbnail", {}).get("source", "")
                    if thumb:
                        thumb_map[t.lower()] = thumb
                for redir in qdata.get("redirects", []):
                    target = redir.get("to", "").lower()
                    source = redir.get("from", "").lower()
                    if target in thumb_map:
                        thumb_map[source] = thumb_map[target]
                for norm in qdata.get("normalized", []):
                    target = norm.get("to", "").lower()
                    source = norm.get("from", "").lower()
                    if target in thumb_map:
                        thumb_map[source] = thumb_map[target]

                for name_lower, place_id in name_map.items():
                    if name_lower in thumb_map:
                        conn.execute(
                            "UPDATE places SET image_url = ? WHERE id = ?",
                            (thumb_map[name_lower], place_id),
                        )
                        resolved += 1
            except Exception as e:
                logger.warning(f"Wikipedia name-search batch failed: {e}")
            time.sleep(REQUEST_DELAY * 2)
        conn.commit()

    # 4. Wikimedia Commons search for remaining places without images
    commons_rows = conn.execute("""
        SELECT id, name, category, county FROM places
        WHERE image_url = '' AND name != '' AND name NOT LIKE '%% at %%'
    """).fetchall()

    if commons_rows:
        if progress_callback:
            progress_callback(f"Searching Wikimedia Commons for {len(commons_rows)} places...")
        for i, row in enumerate(commons_rows):
            if progress_callback and i % 50 == 0:
                progress_callback(f"Commons search... ({i}/{len(commons_rows)})")
            url = image_from_commons_search(row[1], category=row[2], county=row[3], sess=sess)
            if url:
                conn.execute("UPDATE places SET image_url = ? WHERE id = ?", (url, row[0]))
                resolved += 1
            time.sleep(COMMONS_DELAY)
            if i % 100 == 99:
                conn.commit()
        conn.commit()

    conn.close()
    if progress_callback:
        progress_callback(f"DB image enrichment: {resolved} new images resolved")
    return resolved
