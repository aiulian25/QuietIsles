import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "..", "data"))
DB_PATH = os.path.join(DATA_DIR, "quietisles.db")
STATIC_DIR = os.path.join(BASE_DIR, "..", "frontend")
LOGO_PATH = os.path.join(BASE_DIR, "..", "Quiet_Isles.png")

PORT = int(os.environ.get("PORT", 2145))

# Overpass API
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Nominatim
NOMINATIM_URL = "https://nominatim.openstreetmap.org"

# User agent for OSM APIs (required by usage policy)
OSM_USER_AGENT = "QuietIsles/1.0 (landscape-discovery-app)"

# UK bounding box (lat/lon)
UK_BBOX = {
    "south": 49.9,
    "west": -8.2,
    "north": 60.9,
    "east": 1.8,
}

# Natural England Open Data — AONB / National Landscape designations
NATURAL_ENGLAND_AONB_URL = (
    "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/"
    "Areas_of_Outstanding_Natural_Beauty_England/FeatureServer/0/query"
)
NATURAL_ENGLAND_SSSI_URL = (
    "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/"
    "Sites_of_Special_Scientific_Interest_England/FeatureServer/0/query"
)
NATURAL_ENGLAND_TRAIL_URL = (
    "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/"
    "National_Trails_England/FeatureServer/0/query"
)

# NatureScot Open Data Hub
NATURESCOT_URL = (
    "https://ogc.nature.scot/geoserver/protectedareas/ows"
)

# Overpass categories and their OSM tags
PLACE_CATEGORIES = {
    "peak": {"tag": "natural=peak", "icon": "terrain", "label": "Peak"},
    "beach": {"tag": "natural=beach", "icon": "beach_access", "label": "Beach", "allow_unnamed": True},
    "waterfall": {"tag": "waterway=waterfall", "icon": "water_drop", "label": "Waterfall"},
    "cliff": {"tag": "natural=cliff", "icon": "landscape", "label": "Cliff"},
    "viewpoint": {"tag": "tourism=viewpoint", "icon": "visibility", "label": "Viewpoint"},
    "nature_reserve": {"tag": "leisure=nature_reserve", "icon": "forest", "label": "Nature Reserve"},
    "national_park": {"tag": "boundary=national_park", "icon": "park", "label": "National Park"},
    "wood": {"tag": "natural=wood", "icon": "forest", "label": "Woodland", "allow_unnamed": True},
    "heath": {"tag": "natural=heath", "icon": "grass", "label": "Heathland"},
    "moor": {"tag": "natural=moor", "icon": "grass", "label": "Moorland"},
}

# Additional designation categories (from official data sources)
DESIGNATION_CATEGORIES = {
    "aonb": {"icon": "landscape_2", "label": "National Landscape"},
    "sssi": {"icon": "eco", "label": "SSSI"},
    "national_trail": {"icon": "hiking", "label": "National Trail"},
}

# Sync settings
SYNC_BATCH_LIMIT = 500  # max elements per Overpass query
SYNC_DELAY_SECONDS = 5  # delay between Overpass requests (rate limiting)
GEOCODE_BATCH_SIZE = 500  # places to reverse-geocode per batch
GEOCODE_DELAY = 1.1  # Nominatim requires max 1 req/sec
