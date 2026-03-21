"""Fetch protected area designations from Natural England and NatureScot Open Data."""

import logging
import time
import requests
from config import (
    NATURAL_ENGLAND_AONB_URL, NATURAL_ENGLAND_SSSI_URL,
    NATURAL_ENGLAND_TRAIL_URL, NATURESCOT_URL, OSM_USER_AGENT
)

logger = logging.getLogger(__name__)

ARCGIS_TIMEOUT = 30


def _query_arcgis(url, fields="*", where="1=1", max_records=500):
    """Query an ArcGIS REST Feature Service and return features."""
    headers = {"User-Agent": OSM_USER_AGENT}
    params = {
        "where": where,
        "outFields": fields,
        "returnGeometry": "true",
        "geometryType": "esriGeometryEnvelope",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": max_records,
    }
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=ARCGIS_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("features", [])
    except Exception as e:
        logger.error(f"ArcGIS query failed for {url}: {e}")
        return []


def _centroid(geometry):
    """Get approximate centroid of a GeoJSON geometry."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])

    if gtype == "Point":
        return coords[1], coords[0]  # lat, lon
    elif gtype in ("Polygon", "MultiPolygon"):
        # Flatten all coordinate rings and average
        flat = []
        if gtype == "Polygon":
            for ring in coords:
                flat.extend(ring)
        else:
            for polygon in coords:
                for ring in polygon:
                    flat.extend(ring)
        if flat:
            avg_lon = sum(c[0] for c in flat) / len(flat)
            avg_lat = sum(c[1] for c in flat) / len(flat)
            return avg_lat, avg_lon
    elif gtype == "LineString":
        if coords:
            mid = coords[len(coords) // 2]
            return mid[1], mid[0]
    elif gtype == "MultiLineString":
        all_pts = [pt for line in coords for pt in line]
        if all_pts:
            mid = all_pts[len(all_pts) // 2]
            return mid[1], mid[0]

    return None, None


def fetch_aonb_places(progress_callback=None):
    """Fetch Areas of Outstanding Natural Beauty from Natural England."""
    if progress_callback:
        progress_callback("Fetching National Landscapes (AONBs)...")

    features = _query_arcgis(
        NATURAL_ENGLAND_AONB_URL,
        fields="NAME,DESIG_DATE,HOTLINK",
        max_records=200,
    )

    places = []
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        name = props.get("NAME", "").strip()
        if not name:
            continue

        lat, lon = _centroid(geom)
        if lat is None:
            continue

        places.append({
            "osm_id": f"ne_aonb/{name.lower().replace(' ', '_')}",
            "name": name,
            "category": "aonb",
            "lat": lat,
            "lon": lon,
            "description": f"{name} is a designated Area of Outstanding Natural Beauty (National Landscape) in England.",
            "elevation": "",
            "image_url": "",
            "wikidata": "",
            "wikipedia": f"en:{name.replace(' ', '_')}",
            "tags": "{}",
            "region": "",
            "county": "",
            "city": "",
            "designation": "AONB",
            "hidden_score": 0.3,
        })

    logger.info(f"Fetched {len(places)} AONBs from Natural England")
    return places


def fetch_sssi_places(progress_callback=None):
    """Fetch Sites of Special Scientific Interest from Natural England."""
    if progress_callback:
        progress_callback("Fetching SSSI sites...")

    features = _query_arcgis(
        NATURAL_ENGLAND_SSSI_URL,
        fields="SSSI_NAME,STATUS,CITATION",
        where="STATUS='Notified'",
        max_records=500,
    )

    places = []
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        name = props.get("SSSI_NAME", "").strip()
        if not name:
            continue

        lat, lon = _centroid(geom)
        if lat is None:
            continue

        desc = props.get("CITATION", "") or ""
        # Truncate very long citations
        if len(desc) > 500:
            desc = desc[:497] + "..."

        places.append({
            "osm_id": f"ne_sssi/{name.lower().replace(' ', '_')[:80]}",
            "name": name,
            "category": "sssi",
            "lat": lat,
            "lon": lon,
            "description": desc,
            "elevation": "",
            "image_url": "",
            "wikidata": "",
            "wikipedia": "",
            "tags": "{}",
            "region": "",
            "county": "",
            "city": "",
            "designation": "SSSI",
            "hidden_score": 0.7,  # SSSIs are genuine hidden gems
        })

    logger.info(f"Fetched {len(places)} SSSIs from Natural England")
    return places


def fetch_national_trails(progress_callback=None):
    """Fetch National Trails from Natural England."""
    if progress_callback:
        progress_callback("Fetching National Trails...")

    features = _query_arcgis(
        NATURAL_ENGLAND_TRAIL_URL,
        fields="Name,Length_km",
        max_records=100,
    )

    places = []
    seen = set()
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        name = props.get("Name", "").strip()
        if not name or name in seen:
            continue
        seen.add(name)

        lat, lon = _centroid(geom)
        if lat is None:
            continue

        length_km = props.get("Length_km", "")
        desc = f"{name} is a designated National Trail in England."
        if length_km:
            desc += f" It stretches approximately {length_km} km."

        places.append({
            "osm_id": f"ne_trail/{name.lower().replace(' ', '_')}",
            "name": name,
            "category": "national_trail",
            "lat": lat,
            "lon": lon,
            "description": desc,
            "elevation": "",
            "image_url": "",
            "wikidata": "",
            "wikipedia": f"en:{name.replace(' ', '_')}",
            "tags": "{}",
            "region": "",
            "county": "",
            "city": "",
            "designation": "National Trail",
            "hidden_score": 0.2,
            "distance_km": str(length_km) if length_km else "",
        })

    logger.info(f"Fetched {len(places)} National Trails from Natural England")
    return places


def fetch_naturescot_protected(progress_callback=None):
    """Fetch protected areas from NatureScot (Scotland)."""
    if progress_callback:
        progress_callback("Fetching NatureScot protected areas...")

    headers = {"User-Agent": OSM_USER_AGENT}
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": "protectedareas:nsa",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": 200,
    }
    try:
        resp = requests.get(NATURESCOT_URL, params=params, headers=headers, timeout=ARCGIS_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
    except Exception as e:
        logger.error(f"NatureScot query failed: {e}")
        return []

    places = []
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry", {})
        name = props.get("PA_NAME", props.get("NAME", "")).strip()
        if not name:
            continue

        lat, lon = _centroid(geom)
        if lat is None:
            continue

        places.append({
            "osm_id": f"ns_nsa/{name.lower().replace(' ', '_')[:80]}",
            "name": name,
            "category": "nature_reserve",
            "lat": lat,
            "lon": lon,
            "description": f"{name} is a National Scenic Area in Scotland.",
            "elevation": "",
            "image_url": "",
            "wikidata": "",
            "wikipedia": f"en:{name.replace(' ', '_')}",
            "tags": "{}",
            "region": "Scotland",
            "county": "",
            "city": "",
            "designation": "National Scenic Area",
            "hidden_score": 0.5,
        })

    logger.info(f"Fetched {len(places)} National Scenic Areas from NatureScot")
    return places


def sync_designations(progress_callback=None):
    """Fetch all official designation data and return combined place list."""
    all_places = []

    all_places.extend(fetch_aonb_places(progress_callback))
    time.sleep(1)
    all_places.extend(fetch_sssi_places(progress_callback))
    time.sleep(1)
    all_places.extend(fetch_national_trails(progress_callback))
    time.sleep(1)
    all_places.extend(fetch_naturescot_protected(progress_callback))

    if progress_callback:
        progress_callback(f"Designation sync complete: {len(all_places)} official sites")

    return all_places
