// Home page
const HomePage = {
    async render() {
        const container = document.getElementById('page-content');

        // Show loading state
        container.innerHTML = `
            <div class="pt-16">
                <!-- Hero skeleton -->
                <div class="relative w-full h-[600px] md:h-[870px] qi-skeleton"></div>
                <div class="px-8 md:px-16 py-20">
                    <div class="qi-skeleton h-8 w-48 mb-4"></div>
                    <div class="qi-skeleton h-12 w-64 mb-12"></div>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
                        ${Card.skeleton(4)}
                    </div>
                </div>
            </div>`;

        try {
            // Check if we have data
            const stats = await API.getStats();
            if (stats.total_places === 0) {
                container.innerHTML = this.renderEmptyState();
                return;
            }

            const featured = await API.getFeatured();
            const places = featured.places || [];

            // Split: 1 hero, up to 2 secondary, rest as discoveries
            const hero = places[0];
            const secondary = places.slice(1, 3);
            const discoveries = places.slice(3, 7);

            // Also fetch some recent places if not enough featured
            let recent = [];
            if (discoveries.length < 4) {
                const moreData = await API.getPlaces({ per_page: 8 });
                recent = (moreData.places || []).filter(p => !places.find(f => f.id === p.id)).slice(0, 4);
            }

            // Fetch personalised "For You" places based on interests + location
            let forYouPlaces = [];
            let surprisePlace = null;
            const interests = Auth.user?.interests || [];

            if (interests.length > 0) {
                const pos = await GeoHelper.getPosition();
                const fyParams = pos ? { lat: pos.lat, lon: pos.lon, limit: 8 } : { limit: 8 };
                try {
                    const fyData = await API.getForYou(fyParams);
                    forYouPlaces = (fyData.places || []).filter(p => !places.find(f => f.id === p.id));
                } catch {}

                // Surprise: show once per session, only if not already shown
                if (!sessionStorage.getItem('qi_surprise_shown')) {
                    try {
                        const sParams = pos ? { lat: pos.lat, lon: pos.lon } : {};
                        const sData = await API.getSurprise(sParams);
                        if (sData.place) {
                            surprisePlace = sData.place;
                            sessionStorage.setItem('qi_surprise_shown', '1');
                        }
                    } catch {}
                }
            }

            container.innerHTML = this.renderPage(hero, secondary, discoveries.length > 0 ? discoveries : recent, forYouPlaces, surprisePlace);
        } catch (e) {
            console.error('Home page error:', e);
            container.innerHTML = this.renderEmptyState();
        }
    },

    renderPage(hero, secondary, discoveries, forYou = [], surprise = null) {
        return `
        <!-- Hero Section (Environmental Scrim) -->
        ${hero ? this.renderHero(hero) : this.renderDefaultHero()}

        <!-- Content Canvas -->
        <div class="px-8 md:px-16 py-20 bg-surface">

            ${surprise ? this.renderSurprise(surprise) : ''}

            ${forYou.length > 0 ? this.renderForYou(forYou) : ((Auth.user?.interests || []).length === 0 ? this.renderInterestsCta() : '')}

            <!-- Featured Isles (Bento Grid) -->
            ${(hero || secondary.length > 0) ? `
            <div class="mb-32">
                <div class="flex justify-between items-end mb-12">
                    <div>
                        <span class="font-label text-outline uppercase tracking-widest text-xs">Curated Selection</span>
                        <h2 class="font-headline text-3xl font-bold mt-2">Featured Isles</h2>
                    </div>
                    <a href="/explore" data-link class="text-primary text-sm font-semibold flex items-center gap-1 hover:underline underline-offset-4 decoration-primary-dim">
                        View All Collection <span class="material-symbols-outlined text-sm">arrow_forward</span>
                    </a>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-12 grid-rows-2 gap-6 h-auto md:h-[800px]">
                    ${hero ? Card.featuredLarge(hero) : ''}
                    ${secondary.map(p => Card.featuredSmall(p)).join('')}
                </div>
            </div>` : ''}

            <!-- Recently Discovered -->
            ${discoveries.length > 0 ? `
            <div class="mb-20">
                <div class="flex justify-between items-end mb-12">
                    <div>
                        <span class="font-label text-outline uppercase tracking-widest text-xs">Recently Discovered</span>
                        <h2 class="font-headline text-3xl font-bold mt-2">New Explorations</h2>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                    ${discoveries.map(p => Card.discovery(p)).join('')}
                </div>
            </div>` : ''}

            <!-- Footer Teaser -->
            <div class="bg-surface-container-low rounded-3xl p-12 text-center max-w-4xl mx-auto border border-outline-variant/10">
                <span class="material-symbols-outlined text-primary text-5xl mb-6">explore</span>
                <h2 class="font-headline text-3xl font-bold text-on-surface mb-4">The Wild is Calling</h2>
                <p class="text-on-surface-variant font-body mb-8 max-w-xl mx-auto">Join a community of curators documenting the hidden quietude of the British Isles. Your next discovery starts here.</p>
                <a href="/explore" data-link class="inline-block bg-on-surface text-surface px-10 py-4 rounded-full font-headline font-bold text-sm tracking-widest uppercase hover:bg-primary transition-colors">
                    Explore Now
                </a>
            </div>
        </div>`;
    },

    renderForYou(places) {
        return `
        <div class="mb-32">
            <div class="flex justify-between items-end mb-12">
                <div>
                    <span class="font-label text-outline uppercase tracking-widest text-xs">Based on Your Interests</span>
                    <h2 class="font-headline text-3xl font-bold mt-2">For You</h2>
                </div>
                <a href="/settings" data-link class="text-primary text-sm font-semibold flex items-center gap-1 hover:underline underline-offset-4 decoration-primary-dim">
                    Edit Interests <span class="material-symbols-outlined text-sm">tune</span>
                </a>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                ${places.slice(0, 8).map(p => Card.discovery(p)).join('')}
            </div>
        </div>`;
    },

    renderSurprise(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;
        return `
        <div class="mb-20">
            <div class="bg-gradient-to-br from-primary-container/30 to-surface-container-low rounded-3xl border border-primary/15 overflow-hidden">
                <div class="flex flex-col md:flex-row">
                    ${place.image_url ? `
                    <div class="md:w-2/5 h-64 md:h-auto relative">
                        <img src="${Card.escapeHtml(place.image_url)}" alt="${Card.escapeHtml(place.name)}" class="w-full h-full object-cover"/>
                        <div class="absolute inset-0 bg-gradient-to-r from-transparent to-primary-container/30 hidden md:block"></div>
                    </div>` : ''}
                    <div class="flex-1 p-8 md:p-10 flex flex-col justify-center">
                        <div class="flex items-center gap-2 mb-3">
                            <span class="material-symbols-outlined text-primary text-lg">auto_awesome</span>
                            <span class="font-label text-primary uppercase tracking-widest text-xs font-semibold">Surprise Discovery</span>
                        </div>
                        <h3 class="font-headline text-2xl md:text-3xl font-extrabold text-on-surface mb-3 tracking-tight">${Card.escapeHtml(place.name)}</h3>
                        <p class="text-on-surface-variant text-sm mb-2 flex items-center gap-1.5">
                            <span class="material-symbols-outlined text-sm">${icon}</span> ${Card.escapeHtml(label)}
                            ${place.county ? ` &middot; ${Card.escapeHtml(place.county)}` : ''}
                        </p>
                        ${place.description ? `<p class="text-on-surface-variant font-body text-sm mb-6 line-clamp-2">${Card.escapeHtml(place.description)}</p>` : ''}
                        <div>
                            <button onclick="Router.navigate('/place/${place.id}')"
                                class="bg-primary text-on-primary px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform inline-flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm">explore</span> Explore This Place
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    },

    renderInterestsCta() {
        return `
        <div class="mb-20">
            <div class="bg-surface-container-low rounded-3xl p-10 border border-outline-variant/10 text-center max-w-2xl mx-auto">
                <span class="material-symbols-outlined text-primary text-4xl mb-4">tune</span>
                <h3 class="font-headline text-xl font-bold text-on-surface mb-3">Personalise Your Feed</h3>
                <p class="text-on-surface-variant font-body text-sm mb-6 max-w-md mx-auto">
                    Tell us what landscapes you love and we'll suggest places tailored to you, plus the occasional surprise.
                </p>
                <a href="/settings" data-link
                    class="inline-block bg-primary text-on-primary px-8 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform">
                    Pick Your Interests
                </a>
            </div>
        </div>`;
    },

    renderHero(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;

        return `
        <section class="relative w-full h-[600px] md:h-[870px] overflow-hidden">
            <div class="absolute inset-0">
                ${place.image_url
                    ? `<img alt="${Card.escapeHtml(place.name)}" src="${Card.escapeHtml(place.image_url)}" class="w-full h-full object-cover"/>`
                    : `<div class="w-full h-full bg-surface-container-low flex items-center justify-center"><span class="material-symbols-outlined text-[120px] text-outline/10">${icon}</span></div>`
                }
                <div class="absolute inset-0 scrim-gradient"></div>
            </div>
            <div class="relative h-full flex flex-col justify-end pb-24 px-8 md:px-16 max-w-6xl">
                <span class="font-label text-primary uppercase tracking-[0.2em] mb-4 text-xs font-semibold">Discovery of the Week</span>
                <h1 class="font-headline text-5xl md:text-7xl font-extrabold tracking-tighter text-on-surface mb-6 leading-tight cursor-pointer hover:text-primary transition-colors" onclick="Router.navigate('/place/${place.id}')">
                    ${Card.escapeHtml(place.name)}
                </h1>
                <p class="font-body text-on-surface-variant max-w-xl text-lg mb-10 leading-relaxed">
                    ${Card.escapeHtml(place.description || `Discover this beautiful ${label.toLowerCase()} in the British Isles.`)}
                </p>
                <div class="flex flex-wrap gap-4">
                    <button onclick="Router.navigate('/place/${place.id}')" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-4 rounded-full font-headline font-bold text-sm tracking-wide shadow-xl hover:scale-105 transition-transform">
                        Start Journey
                    </button>
                    <a href="/explore" data-link class="bg-transparent border border-outline/20 text-on-surface px-8 py-4 rounded-full font-headline font-bold text-sm tracking-wide hover:bg-surface-container-low transition-colors">
                        Explore Trails
                    </a>
                </div>
            </div>
        </section>`;
    },

    renderDefaultHero() {
        return `
        <section class="relative w-full h-[600px] md:h-[870px] overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-surface-container-low to-primary-container/20">
                <div class="absolute inset-0 scrim-gradient"></div>
            </div>
            <div class="relative h-full flex flex-col justify-end pb-24 px-8 md:px-16 max-w-6xl">
                <span class="font-label text-primary uppercase tracking-[0.2em] mb-4 text-xs font-semibold">Welcome to</span>
                <h1 class="font-headline text-5xl md:text-7xl font-extrabold tracking-tighter text-on-surface mb-6 leading-tight">
                    Quiet Isles
                </h1>
                <p class="font-body text-on-surface-variant max-w-xl text-lg mb-10 leading-relaxed">
                    Navigate the ancient pathways of the British landscape where the earth meets the sky in a symphony of silence and slate.
                </p>
                <div class="flex flex-wrap gap-4">
                    <a href="/explore" data-link class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-4 rounded-full font-headline font-bold text-sm tracking-wide shadow-xl hover:scale-105 transition-transform">
                        Start Exploring
                    </a>
                </div>
            </div>
        </section>`;
    },

    renderEmptyState() {
        return `
        <div class="pt-16">
            ${this.renderDefaultHero()}
            <div class="px-8 md:px-16 py-20 bg-surface">
                <div class="bg-surface-container-low rounded-3xl p-12 text-center max-w-2xl mx-auto border border-outline-variant/10">
                    <span class="material-symbols-outlined text-primary text-5xl mb-6">cloud_download</span>
                    <h2 class="font-headline text-2xl font-bold text-on-surface mb-4">Initialize Your Atlas</h2>
                    <p class="text-on-surface-variant font-body mb-8 max-w-md mx-auto">
                        Sync landscape data from OpenStreetMap to populate your discovery feed with mountains, beaches, cliffs, viewpoints and more across the UK.
                    </p>
                    <button id="sync-btn" onclick="HomePage.startSync()" class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-10 py-4 rounded-full font-headline font-bold text-sm tracking-widest uppercase hover:scale-105 transition-transform">
                        Sync Landscape Data
                    </button>
                    <div id="sync-status" class="mt-6 text-sm text-outline hidden">
                        <div class="qi-spinner mx-auto mb-4"></div>
                        <p id="sync-message">Starting sync...</p>
                    </div>
                </div>
            </div>
        </div>`;
    },

    async startSync() {
        const btn = document.getElementById('sync-btn');
        const status = document.getElementById('sync-status');
        const msg = document.getElementById('sync-message');

        if (btn) btn.style.display = 'none';
        if (status) status.classList.remove('hidden');

        try {
            await API.triggerSync();

            // Poll status
            const poll = setInterval(async () => {
                try {
                    const s = await API.getSyncStatus();
                    if (msg) msg.textContent = s.message || 'Syncing...';

                    if (!s.running && s.progress >= 100) {
                        clearInterval(poll);
                        // Reload the page
                        setTimeout(() => this.render(), 1000);
                    }
                } catch (e) {
                    clearInterval(poll);
                }
            }, 2000);
        } catch (e) {
            if (msg) msg.textContent = 'Sync failed. Please try again.';
            if (btn) btn.style.display = 'inline-block';
        }
    },
};
