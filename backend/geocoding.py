import logging
import time
import requests
from config import NOMINATIM_URL, OSM_USER_AGENT, GEOCODE_DELAY

logger = logging.getLogger(__name__)


def search_places(query, limit=10):
    """Search for places using Nominatim geocoding."""
    headers = {"User-Agent": OSM_USER_AGENT}
    params = {
        "q": query,
        "format": "json",
        "limit": limit,
        "countrycodes": "gb",
        "addressdetails": 1,
    }
    try:
        resp = requests.get(
            f"{NOMINATIM_URL}/search",
            params=params,
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Nominatim search failed: {e}")
        return []


def reverse_geocode(lat, lon):
    """Reverse geocode coordinates to a place name."""
    headers = {"User-Agent": OSM_USER_AGENT}
    params = {
        "lat": lat,
        "lon": lon,
        "format": "json",
        "addressdetails": 1,
    }
    try:
        resp = requests.get(
            f"{NOMINATIM_URL}/reverse",
            params=params,
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Nominatim reverse geocode failed: {e}")
        return {}


def _extract_location(address):
    """Extract county, city, region and formatted address from Nominatim address details."""
    county = (
        address.get("county", "")
        or address.get("state_district", "")
    )
    city = (
        address.get("city", "")
        or address.get("town", "")
        or address.get("village", "")
        or address.get("hamlet", "")
    )
    region = (
        address.get("state", "")
        or address.get("region", "")
        or address.get("country", "")
    )
    # Build a human-friendly address line: "Village, Town, County POSTCODE"
    parts = []
    village = address.get("village", "") or address.get("hamlet", "")
    town = address.get("town", "") or address.get("city", "")
    if village:
        parts.append(village)
    if town and town != village:
        parts.append(town)
    if county:
        parts.append(county)
    postcode = address.get("postcode", "")
    if postcode:
        parts.append(postcode)
    formatted = ", ".join(parts)

    return county, city, region, formatted


def batch_reverse_geocode(places, progress_callback=None):
    """
    Reverse geocode a list of place dicts (must have id, lat, lon, name).
    Returns list of (place_id, county, city, region, address) tuples.
    Respects Nominatim rate limit of 1 request per second.
    """
    results = []
    total = len(places)

    for i, place in enumerate(places):
        if progress_callback:
            progress_callback(f"Reverse geocoding... ({i}/{total})", i, total)

        data = reverse_geocode(place["lat"], place["lon"])
        address = data.get("address", {})
        county, city, region, formatted = _extract_location(address)

        if county or city or region:
            results.append((place["id"], county, city, region, formatted))
        else:
            # Mark as geocoded (no data found) to avoid infinite retry
            results.append((place["id"], "-", "", "", "-"))

        # Nominatim requires max 1 request per second
        time.sleep(GEOCODE_DELAY)

    if progress_callback:
        progress_callback(f"Geocoding complete: {len(results)}/{total} places enriched", total, total)

    return results
