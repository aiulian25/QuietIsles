// Explore page with map
const ExplorePage = {
    map: null,
    currentCategory: 'all',
    userPos: null,
    radiusKm: 100,
    places: [],
    page: 1,
    loading: false,

    async render() {
        const container = document.getElementById('page-content');

        container.innerHTML = `
        <div class="flex flex-col md:flex-row h-[calc(100vh)] pt-16">
            <!-- Map Panel -->
            <section class="w-full md:w-3/5 relative bg-surface-container-lowest h-[40vh] md:h-full">
                <div id="explore-map" class="w-full h-full"></div>
                <!-- Floating Search -->
                <div class="absolute top-4 left-4 right-4 md:left-6 md:w-96 z-[1000]">
                    <div class="flex items-center bg-surface-container-high/70 backdrop-blur-xl border border-outline-variant/10 rounded-full px-5 py-3 shadow-2xl">
                        <span class="material-symbols-outlined text-outline mr-3">search</span>
                        <input id="explore-search" type="text" class="bg-transparent border-none focus:ring-0 text-sm w-full placeholder:text-outline/50 outline-none" placeholder="Search the British Isles..."/>
                        <span class="material-symbols-outlined text-outline cursor-pointer hover:text-primary" onclick="ExplorePage.toggleFilters()">tune</span>
                    </div>
                </div>
                <!-- Distance Filter (hidden by default) -->
                <div id="distance-filter" class="absolute top-20 left-4 md:left-6 z-[1000] hidden">
                    <div class="bg-surface-container-high/90 backdrop-blur-xl border border-outline-variant/10 rounded-2xl p-4 shadow-2xl w-72">
                        <label class="text-xs text-outline uppercase tracking-widest mb-2 block">Distance Radius</label>
                        <div class="flex items-center gap-3">
                            <input id="radius-slider" type="range" min="10" max="500" value="100" class="flex-1 accent-primary" oninput="ExplorePage.updateRadius(this.value)"/>
                            <span id="radius-value" class="text-sm font-bold text-primary w-16 text-right">100 km</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Results Panel -->
            <section class="w-full md:w-2/5 flex flex-col bg-surface border-l border-outline-variant/10 h-[60vh] md:h-full">
                <!-- Filters -->
                <div class="p-6 md:p-8 space-y-6 flex-shrink-0">
                    <div class="flex items-baseline justify-between">
                        <h2 class="text-3xl font-headline font-extrabold tracking-tighter text-on-surface">Atmospheres</h2>
                        <span id="results-count" class="text-[10px] font-label uppercase tracking-[0.2em] text-outline">Loading...</span>
                    </div>
                    <div id="category-filters" class="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
                        <button onclick="ExplorePage.setCategory('all')" class="cat-btn px-5 py-2.5 bg-primary text-on-primary rounded-full text-xs font-semibold whitespace-nowrap" data-cat="all">All Locations</button>
                    </div>
                </div>

                <!-- Results List -->
                <div id="explore-results" class="flex-1 overflow-y-auto px-6 md:px-8 pb-24 md:pb-8 custom-scrollbar space-y-8">
                    <div class="flex justify-center py-12"><div class="qi-spinner"></div></div>
                </div>
            </section>
        </div>`;

        // Initialize map
        setTimeout(() => {
            this.initMap();
            this.loadCategories();
            this.loadPlaces();
            this.setupSearch();
        }, 100);
    },

    initMap() {
        this.map = MapComponent.init('explore-map', {
            center: [54.5, -3.5],
            zoom: 6,
        });

        // Try to get user location
        GeoHelper.getPosition().then(pos => {
            if (pos) {
                this.userPos = pos;
                MapComponent.addUserMarker(pos.lat, pos.lon);
                this.map.setView([pos.lat, pos.lon], 8);
            }
        });
    },

    async loadCategories() {
        try {
            const data = await API.getCategories();
            const filtersEl = document.getElementById('category-filters');
            if (!filtersEl) return;

            let html = `<button onclick="ExplorePage.setCategory('all')" class="cat-btn px-5 py-2.5 bg-primary text-on-primary rounded-full text-xs font-semibold whitespace-nowrap" data-cat="all">All Locations</button>`;

            (data.categories || []).forEach(cat => {
                if (cat.count > 0) {
                    html += `<button onclick="ExplorePage.setCategory('${cat.key}')" class="cat-btn px-5 py-2.5 bg-surface-container-high text-on-surface hover:bg-surface-bright transition-colors rounded-full text-xs font-medium whitespace-nowrap flex items-center gap-2" data-cat="${cat.key}">
                        <span class="material-symbols-outlined text-sm">${cat.icon}</span> ${Card.escapeHtml(cat.label)}
                    </button>`;
                }
            });

            filtersEl.innerHTML = html;
        } catch (e) {
            console.error('Failed to load categories:', e);
        }
    },

    async loadPlaces() {
        if (this.loading) return;
        this.loading = true;

        const resultsEl = document.getElementById('explore-results');
        if (this.page === 1 && resultsEl) {
            resultsEl.innerHTML = '<div class="flex justify-center py-12"><div class="qi-spinner"></div></div>';
        }

        const params = {
            category: this.currentCategory,
            page: this.page,
            per_page: 20,
        };

        if (this.userPos) {
            params.lat = this.userPos.lat;
            params.lon = this.userPos.lon;
            params.radius_km = this.radiusKm;
        }

        try {
            const data = await API.getPlaces(params);
            this.places = this.page === 1 ? data.places : [...this.places, ...data.places];

            this.renderResults();
            MapComponent.addPlaceMarkers(this.places, (place) => {
                Router.navigate(`/place/${place.id}`);
            });

            const countEl = document.getElementById('results-count');
            if (countEl) countEl.textContent = `${this.places.length} Curations`;
        } catch (e) {
            console.error('Failed to load places:', e);
            if (resultsEl) resultsEl.innerHTML = '<p class="text-center text-outline py-12">Failed to load places.</p>';
        } finally {
            this.loading = false;
        }
    },

    renderResults() {
        const resultsEl = document.getElementById('explore-results');
        if (!resultsEl) return;

        if (this.places.length === 0) {
            resultsEl.innerHTML = `
                <div class="text-center py-12">
                    <span class="material-symbols-outlined text-4xl text-outline/30 mb-4">search_off</span>
                    <p class="text-outline">No places found. Try adjusting your filters or distance.</p>
                </div>`;
            return;
        }

        resultsEl.innerHTML = this.places.map(p => Card.exploreCard(p, this.userPos)).join('');
    },

    setCategory(cat) {
        this.currentCategory = cat;
        this.page = 1;

        // Update button styles
        document.querySelectorAll('.cat-btn').forEach(btn => {
            const isActive = btn.dataset.cat === cat;
            btn.classList.toggle('bg-primary', isActive);
            btn.classList.toggle('text-on-primary', isActive);
            btn.classList.toggle('bg-surface-container-high', !isActive);
            btn.classList.toggle('text-on-surface', !isActive);
        });

        this.loadPlaces();
    },

    toggleFilters() {
        const el = document.getElementById('distance-filter');
        if (el) el.classList.toggle('hidden');
    },

    updateRadius(val) {
        this.radiusKm = parseInt(val);
        const label = document.getElementById('radius-value');
        if (label) label.textContent = `${val} km`;
        // Debounce reload
        clearTimeout(this._radiusTimeout);
        this._radiusTimeout = setTimeout(() => {
            this.page = 1;
            this.loadPlaces();
        }, 500);
    },

    setupSearch() {
        const input = document.getElementById('explore-search');
        if (!input) return;

        let timeout;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                const q = input.value.trim();
                if (q.length < 2) {
                    this.page = 1;
                    this.loadPlaces();
                    return;
                }

                try {
                    const data = await API.searchPlaces(q);
                    this.places = data.places || [];
                    this.renderResults();
                    MapComponent.addPlaceMarkers(this.places, (place) => {
                        Router.navigate(`/place/${place.id}`);
                    });

                    // If geocoding results, pan map
                    if (data.geocoding && data.geocoding.length > 0) {
                        const geo = data.geocoding[0];
                        if (this.map) {
                            this.map.setView([geo.lat, geo.lon], 10);
                        }
                    }
                } catch (e) {
                    console.error('Search failed:', e);
                }
            }, 400);
        });
    },

    destroy() {
        MapComponent.destroy();
        this.map = null;
        this.places = [];
        this.page = 1;
    }
};
