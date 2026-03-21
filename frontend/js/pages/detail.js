// Place Detail page
const DetailPage = {
    previewMap: null,

    async render(placeId) {
        const container = document.getElementById('page-content');

        // Loading state
        container.innerHTML = `
        <div class="pt-16">
            <div class="w-full h-[500px] qi-skeleton"></div>
            <div class="px-8 md:px-16 py-12 max-w-7xl mx-auto">
                <div class="qi-skeleton h-10 w-3/4 mb-4"></div>
                <div class="qi-skeleton h-6 w-1/2 mb-8"></div>
                <div class="qi-skeleton h-40 w-full"></div>
            </div>
        </div>`;

        try {
            const place = await API.getPlace(placeId);
            if (!place || place.error) {
                container.innerHTML = this.renderNotFound();
                return;
            }
            container.innerHTML = this.renderPage(place);

            // Init preview map after render
            setTimeout(() => {
                if (place.lat && place.lon) {
                    this.previewMap = MapComponent.initPreview('detail-map', place.lat, place.lon);
                }
            }, 200);
        } catch (e) {
            console.error('Detail page error:', e);
            container.innerHTML = this.renderNotFound();
        }
    },

    renderPage(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;
        const savedClass = place.is_saved ? 'filled' : '';
        const savedText = place.is_saved ? 'Saved' : 'Save to Trails';
        const county = (place.county && place.county !== '-') ? place.county : '';
        const city = (place.city && place.city !== '-') ? place.city : '';

        return `
        <!-- Hero Environmental Scrim -->
        <section class="relative w-full h-[500px] md:h-[716px] flex flex-col justify-end overflow-hidden">
            <div class="absolute inset-0 z-0">
                ${place.image_url
                    ? `<img alt="${Card.escapeHtml(place.name)}" src="${Card.escapeHtml(place.image_url)}" class="w-full h-full object-cover scale-105"/>`
                    : `<div class="w-full h-full bg-surface-container-low flex items-center justify-center"><span class="material-symbols-outlined text-[120px] text-outline/10">${icon}</span></div>`
                }
                <div class="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent"></div>
            </div>
            <div class="relative z-10 px-6 md:px-16 pb-12 max-w-7xl mx-auto w-full">
                <div class="mb-4 flex flex-wrap gap-2">
                    <span class="bg-primary/20 backdrop-blur-md border border-primary/30 text-on-surface px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-semibold">${Card.escapeHtml(label)}</span>
                    ${place.elevation ? `<span class="bg-surface-container-high/60 backdrop-blur-md border border-outline-variant/20 text-on-surface px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-semibold">${Card.escapeHtml(place.elevation)}m Elevation</span>` : ''}
                    ${place.designation ? `<span class="bg-primary/20 backdrop-blur-md border border-primary/30 text-on-surface px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-semibold">${Card.escapeHtml(place.designation)}</span>` : ''}
                </div>
                <h1 class="font-headline text-5xl md:text-7xl font-bold tracking-tighter leading-none text-on-surface mb-6 drop-shadow-2xl">
                    ${Card.escapeHtml(place.name)}
                </h1>
                <div class="flex items-center gap-6 text-on-surface-variant font-medium flex-wrap">
                    ${place.address ? `<div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-sm">location_on</span>
                        <span class="text-sm">${Card.escapeHtml(place.address)}</span>
                    </div>` : (city || county) ? `<div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-sm">location_on</span>
                        <span class="text-sm">${Card.escapeHtml([city, county].filter(Boolean).join(', '))}</span>
                    </div>` : ''}
                    ${place.region ? `<div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-sm">map</span>
                        <span class="text-sm">${Card.escapeHtml(place.region)}</span>
                    </div>` : ''}
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary text-sm">pin_drop</span>
                        <span class="text-sm">${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- Content Grid -->
        <section class="px-6 md:px-16 py-12 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 pb-32">
            <!-- Left Column: Description -->
            <div class="lg:col-span-7 space-y-16">
                ${place.description ? `
                <div>
                    <h2 class="font-headline text-sm uppercase tracking-[0.2em] text-primary mb-6">The Narrative</h2>
                    <p class="text-on-surface leading-relaxed text-lg font-light opacity-90 max-w-2xl">
                        ${Card.escapeHtml(place.description)}
                    </p>
                </div>` : ''}

                ${!place.description ? `
                <div>
                    <h2 class="font-headline text-sm uppercase tracking-[0.2em] text-primary mb-6">About This Place</h2>
                    <p class="text-on-surface leading-relaxed text-lg font-light opacity-90 max-w-2xl">
                        ${Card.escapeHtml(place.name)} is a beautiful ${label.toLowerCase()} located in the British Isles${place.address ? `, at ${place.address}` : (city || county) ? `, near ${[city, county].filter(Boolean).join(', ')}` : (place.region ? `, in the ${place.region} area` : '')}.
                        ${place.elevation ? ` Standing at ${place.elevation}m, it offers stunning views of the surrounding landscape.` : ''}
                        Discover this remarkable natural feature and add it to your collection of quiet isles.
                    </p>
                </div>` : ''}

                <!-- Wikipedia link if available -->
                ${place.wikipedia ? `
                <div>
                    <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(place.wikipedia.replace(/^en:/, ''))}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-primary hover:underline underline-offset-4">
                        <span class="material-symbols-outlined text-sm">open_in_new</span>
                        Read more on Wikipedia
                    </a>
                </div>` : ''}
            </div>

            <!-- Right Column: Details & CTA -->
            <div class="lg:col-span-5 space-y-8">
                <!-- Journey Card -->
                <div class="bg-surface-container-high rounded-3xl p-8 border border-outline-variant/10 shadow-2xl relative overflow-hidden group">
                    <div class="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 blur-[80px] rounded-full group-hover:bg-primary/20 transition-all duration-700"></div>
                    <div class="relative z-10 space-y-8">
                        <div>
                            <h3 class="font-headline text-2xl font-bold mb-2">Plan Your Journey</h3>
                            <p class="text-sm text-outline">Essential details for your visit.</p>
                        </div>
                        <div class="space-y-6">
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Category</span>
                                <span class="text-sm font-bold text-primary">${Card.escapeHtml(label)}</span>
                            </div>
                            ${place.designation ? `
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Designation</span>
                                <span class="text-sm font-bold text-primary">${Card.escapeHtml(place.designation)}</span>
                            </div>` : ''}
                            ${place.address ? `
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Address</span>
                                <span class="text-sm font-bold text-right max-w-[200px]">${Card.escapeHtml(place.address)}</span>
                            </div>` : (city || county) ? `
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Location</span>
                                <span class="text-sm font-bold">${Card.escapeHtml([city, county].filter(Boolean).join(', '))}</span>
                            </div>` : ''}
                            ${place.elevation ? `
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Elevation</span>
                                <span class="text-sm font-bold">${Card.escapeHtml(place.elevation)}m</span>
                            </div>` : ''}
                            <div class="flex justify-between items-center py-4 border-b border-outline-variant/10">
                                <span class="text-sm text-on-surface-variant font-medium">Coordinates</span>
                                <span class="text-sm font-bold">${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}</span>
                            </div>
                        </div>
                        <div class="pt-4 space-y-4">
                            <button id="save-btn" onclick="DetailPage.toggleSave(${place.id})" class="w-full py-4 rounded-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold tracking-tight shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                                <span class="material-symbols-outlined text-lg ${savedClass}">bookmark</span>
                                ${savedText}
                            </button>
                            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + (place.address ? ', ' + place.address : ''))}" target="_blank" rel="noopener" class="w-full py-4 rounded-full border border-outline/20 text-on-surface font-semibold hover:bg-surface-bright transition-colors flex items-center justify-center gap-2">
                                <span class="material-symbols-outlined text-lg">directions</span>
                                Get Directions
                            </a>
                            <a href="https://maps.apple.com/?q=${encodeURIComponent(place.name)}&ll=${place.lat},${place.lon}" target="_blank" rel="noopener" class="w-full py-3 rounded-full border border-outline/10 text-on-surface-variant text-sm font-medium hover:bg-surface-bright transition-colors flex items-center justify-center gap-2">
                                <span class="material-symbols-outlined text-base">map</span>
                                Open in Apple Maps
                            </a>
                        </div>
                    </div>
                </div>

                <!-- Map Preview -->
                ${place.lat && place.lon ? `
                <div class="rounded-3xl h-48 w-full bg-surface-container-highest overflow-hidden relative group cursor-pointer" onclick="window.open('https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=14/${place.lat}/${place.lon}', '_blank')">
                    <div id="detail-map" class="w-full h-full"></div>
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center p-4 pointer-events-none bg-surface/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="material-symbols-outlined text-primary text-4xl mb-2">explore</span>
                        <span class="text-on-surface font-headline font-bold">Open Full Map</span>
                    </div>
                </div>` : ''}
            </div>
        </section>`;
    },

    renderNotFound() {
        return `
        <div class="pt-16 flex items-center justify-center min-h-[60vh]">
            <div class="text-center">
                <span class="material-symbols-outlined text-6xl text-outline/30 mb-4">search_off</span>
                <h2 class="font-headline text-2xl font-bold mb-4">Place Not Found</h2>
                <p class="text-outline mb-8">This place doesn't exist or has been removed.</p>
                <a href="/explore" data-link class="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-full font-headline font-bold text-sm">
                    Explore Places
                </a>
            </div>
        </div>`;
    },

    async toggleSave(placeId) {
        const btn = document.getElementById('save-btn');
        if (!btn) return;

        const icon = btn.querySelector('.material-symbols-outlined');
        const isSaved = icon.classList.contains('filled');

        try {
            if (isSaved) {
                await API.unsavePlace(placeId);
                icon.classList.remove('filled');
                btn.innerHTML = `<span class="material-symbols-outlined text-lg">bookmark</span> Save to Trails`;
            } else {
                await API.savePlace(placeId);
                icon.classList.add('filled');
                btn.innerHTML = `<span class="material-symbols-outlined text-lg filled">bookmark</span> Saved`;
            }
        } catch (e) {
            console.error('Save toggle failed:', e);
        }
    },

    destroy() {
        if (this.previewMap) {
            this.previewMap.remove();
            this.previewMap = null;
        }
    }
};
