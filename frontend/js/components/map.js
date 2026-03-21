// Map component using Leaflet
const MapComponent = {
    map: null,
    markers: [],
    markerLayer: null,

    init(containerId, options = {}) {
        const defaults = {
            center: [54.5, -3.5], // Center of UK
            zoom: 6,
            minZoom: 5,
            maxZoom: 18,
        };
        const opts = { ...defaults, ...options };

        if (this.map) {
            this.map.remove();
        }

        this.map = L.map(containerId, {
            center: opts.center,
            zoom: opts.zoom,
            minZoom: opts.minZoom,
            maxZoom: opts.maxZoom,
            zoomControl: true,
            attributionControl: true,
        });

        // Dark-styled CartoDB tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 19,
            subdomains: 'abcd',
        }).addTo(this.map);

        this.markerLayer = L.layerGroup().addTo(this.map);

        return this.map;
    },

    addPlaceMarkers(places, onClick) {
        this.markerLayer.clearLayers();
        this.markers = [];

        places.forEach(place => {
            if (!place.lat || !place.lon) return;

            const icon = L.divIcon({
                className: '',
                html: `<div class="qi-marker"><span class="material-symbols-outlined">${CATEGORY_ICONS[place.category] || 'place'}</span></div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            });

            const marker = L.marker([place.lat, place.lon], { icon })
                .bindPopup(`
                    <div class="p-2 min-w-[150px]">
                        <div class="font-headline font-bold text-sm mb-1">${Card.escapeHtml(place.name)}</div>
                        <div class="text-[10px] text-outline uppercase tracking-wider">${CATEGORY_LABELS[place.category] || place.category}</div>
                    </div>
                `, { closeButton: false, className: '' });

            if (onClick) {
                marker.on('click', () => onClick(place));
            }

            marker.addTo(this.markerLayer);
            this.markers.push(marker);
        });
    },

    addUserMarker(lat, lon) {
        const userIcon = L.divIcon({
            className: '',
            html: `<div class="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
        });
        L.marker([lat, lon], { icon: userIcon }).addTo(this.markerLayer);
    },

    fitToMarkers() {
        if (this.markers.length > 0) {
            const group = L.featureGroup(this.markers);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
    },

    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    },

    // Small preview map for detail page
    initPreview(containerId, lat, lon, zoom = 13) {
        const map = L.map(containerId, {
            center: [lat, lon],
            zoom: zoom,
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd',
        }).addTo(map);

        const icon = L.divIcon({
            className: '',
            html: `<div class="qi-marker"><span class="material-symbols-outlined">location_on</span></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });

        L.marker([lat, lon], { icon }).addTo(map);
        return map;
    },
};
