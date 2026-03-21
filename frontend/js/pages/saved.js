// Saved Trails page
const SavedPage = {
    async render() {
        const container = document.getElementById('page-content');

        container.innerHTML = `
        <div class="pt-24 pb-32 px-6 md:px-12 max-w-7xl mx-auto">
            <div class="flex justify-center py-12"><div class="qi-spinner"></div></div>
        </div>`;

        try {
            const data = await API.getSaved();
            const places = data.places || [];
            container.innerHTML = this.renderPage(places);
        } catch (e) {
            console.error('Saved page error:', e);
            container.innerHTML = this.renderPage([]);
        }
    },

    renderPage(places) {
        if (places.length === 0) {
            return this.renderEmpty();
        }

        // Group places by category
        const grouped = {};
        places.forEach(p => {
            const label = CATEGORY_LABELS[p.category] || p.category;
            if (!grouped[label]) grouped[label] = [];
            grouped[label].push(p);
        });

        let sectionsHtml = '';
        for (const [label, categoryPlaces] of Object.entries(grouped)) {
            sectionsHtml += `
            <section class="mb-16">
                <div class="flex items-baseline justify-between mb-8">
                    <div>
                        <span class="text-[10px] font-headline uppercase tracking-widest text-primary-dim block mb-1">Landscape Type</span>
                        <h2 class="font-headline text-3xl font-extrabold tracking-tight text-on-surface">${Card.escapeHtml(label)}s</h2>
                    </div>
                    <span class="text-outline text-sm font-medium">${categoryPlaces.length} Item${categoryPlaces.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    ${categoryPlaces.map(p => Card.savedCard(p)).join('')}
                </div>
            </section>`;
        }

        return `
        <div class="pt-24 pb-32 px-6 md:px-12 max-w-7xl mx-auto">
            <!-- Header -->
            <div class="flex items-center justify-between mb-12">
                <div>
                    <span class="text-[10px] font-headline uppercase tracking-widest text-primary-dim block mb-1">Your Collection</span>
                    <h1 class="font-headline text-4xl font-extrabold tracking-tighter text-on-surface">Saved Trails</h1>
                </div>
                <div class="relative hidden sm:block">
                    <input id="saved-search" type="text" placeholder="Search saved..." class="bg-surface-container-highest border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-1 focus:ring-primary w-48 md:w-64"/>
                    <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
                </div>
            </div>

            ${sectionsHtml}
        </div>`;
    },

    renderEmpty() {
        return `
        <div class="pt-24 pb-32 px-6 md:px-12 max-w-7xl mx-auto">
            <div class="flex items-center justify-center min-h-[50vh]">
                <div class="text-center">
                    <span class="material-symbols-outlined text-6xl text-outline/30 mb-6">bookmark_border</span>
                    <h2 class="font-headline text-2xl font-bold mb-4">No Saved Trails Yet</h2>
                    <p class="text-on-surface-variant font-body mb-8 max-w-md mx-auto">
                        Start exploring the British landscape and save your favorite places to build your personal collection of quiet isles.
                    </p>
                    <a href="/explore" data-link class="inline-block bg-gradient-to-br from-primary to-primary-container text-on-primary px-10 py-4 rounded-full font-headline font-bold text-sm tracking-widest uppercase hover:scale-105 transition-transform">
                        Start Exploring
                    </a>
                </div>
            </div>
        </div>`;
    },
};
