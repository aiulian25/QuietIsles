// Card components
const Card = {
    // Build location string from county/city/region
    locationStr(place) {
        if (place.address) return place.address;
        const parts = [];
        if (place.city && place.city !== '-') parts.push(place.city);
        if (place.county && place.county !== '-') parts.push(place.county);
        if (!parts.length && place.region) parts.push(place.region);
        return parts.join(', ');
    },

    // Discovery card for home grid (4/5 aspect ratio)
    discovery(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;
        const imgSrc = place.image_url || `/api/places/${place.id}/image`;
        const savedClass = place.is_saved ? 'filled text-primary' : '';

        return `
        <div class="group cursor-pointer" onclick="Router.navigate('/place/${place.id}')">
            <div class="aspect-[4/5] overflow-hidden rounded-xl mb-6 bg-surface-container-low relative">
                ${place.image_url
                    ? `<img alt="${this.escapeHtml(place.name)}" src="${this.escapeHtml(place.image_url)}" class="w-full h-full object-cover grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-105" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
                       <div class="w-full h-full items-center justify-center bg-surface-container-low hidden">
                           <span class="material-symbols-outlined text-6xl text-outline/30">${icon}</span>
                       </div>`
                    : `<div class="w-full h-full flex items-center justify-center bg-surface-container-low">
                           <span class="material-symbols-outlined text-6xl text-outline/30">${icon}</span>
                       </div>`
                }
                <div class="absolute top-4 right-4">
                    <button onclick="event.stopPropagation(); Card.toggleSave(${place.id}, this)" class="w-10 h-10 rounded-full bg-surface-container-highest/60 backdrop-blur-md flex items-center justify-center text-on-surface hover:text-primary transition-colors">
                        <span class="material-symbols-outlined text-lg ${savedClass}">bookmark</span>
                    </button>
                </div>
            </div>
            <h4 class="font-headline text-lg font-bold text-on-surface group-hover:text-primary transition-colors">${this.escapeHtml(place.name)}</h4>
            <p class="text-outline text-sm font-body">${this.escapeHtml(this.locationStr(place) || label)}</p>
        </div>`;
    },

    // Featured bento card (large)
    featuredLarge(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;

        return `
        <div class="md:col-span-8 md:row-span-2 relative group overflow-hidden rounded-xl bg-surface-container-low cursor-pointer" onclick="Router.navigate('/place/${place.id}')">
            ${place.image_url
                ? `<img alt="${this.escapeHtml(place.name)}" src="${this.escapeHtml(place.image_url)}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 grayscale-[30%] group-hover:grayscale-0"/>`
                : `<div class="w-full h-full flex items-center justify-center min-h-[400px]"><span class="material-symbols-outlined text-8xl text-outline/20">${icon}</span></div>`
            }
            <div class="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-transparent to-transparent opacity-80"></div>
            <div class="absolute bottom-0 left-0 p-8">
                <h3 class="font-headline text-3xl font-bold text-on-surface mb-2">${this.escapeHtml(place.name)}</h3>
                <p class="text-on-surface-variant font-body text-sm mb-4">${this.escapeHtml(this.locationStr(place))}</p>
                <div class="flex gap-2">
                    <span class="bg-primary/10 border border-primary/20 text-primary text-[10px] uppercase tracking-tighter px-2 py-1 rounded">${this.escapeHtml(label)}</span>
                    ${place.elevation ? `<span class="bg-primary/10 border border-primary/20 text-primary text-[10px] uppercase tracking-tighter px-2 py-1 rounded">${this.escapeHtml(place.elevation)}m</span>` : ''}
                    ${place.designation ? `<span class="bg-primary/10 border border-primary/20 text-primary text-[10px] uppercase tracking-tighter px-2 py-1 rounded">${this.escapeHtml(place.designation)}</span>` : ''}
                </div>
            </div>
        </div>`;
    },

    // Featured bento card (small)
    featuredSmall(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';

        return `
        <div class="md:col-span-4 md:row-span-1 relative group overflow-hidden rounded-xl bg-surface-container-low cursor-pointer" onclick="Router.navigate('/place/${place.id}')">
            ${place.image_url
                ? `<img alt="${this.escapeHtml(place.name)}" src="${this.escapeHtml(place.image_url)}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"/>`
                : `<div class="w-full h-full flex items-center justify-center min-h-[200px]"><span class="material-symbols-outlined text-6xl text-outline/20">${icon}</span></div>`
            }
            <div class="absolute inset-0 bg-surface-container-lowest/40 group-hover:bg-transparent transition-all duration-500"></div>
            <div class="absolute bottom-0 left-0 p-6">
                <h3 class="font-headline text-xl font-bold text-on-surface">${this.escapeHtml(place.name)}</h3>
            </div>
        </div>`;
    },

    // Explore list card
    exploreCard(place, userPos) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;
        let distText = '';
        if (place.distance_from_user != null) {
            distText = `${Math.round(place.distance_from_user)} km`;
        } else if (userPos) {
            const d = GeoHelper.distance(userPos.lat, userPos.lon, place.lat, place.lon);
            distText = `${Math.round(d)} km`;
        }

        return `
        <div class="group relative bg-surface-container-low rounded-xl overflow-hidden transition-all duration-300 hover:bg-surface-container-high cursor-pointer" onclick="Router.navigate('/place/${place.id}')">
            <div class="aspect-[16/9] overflow-hidden">
                ${place.image_url
                    ? `<img src="${this.escapeHtml(place.image_url)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" onerror="this.style.display='none'"/>`
                    : `<div class="w-full h-full flex items-center justify-center bg-surface-container-low"><span class="material-symbols-outlined text-5xl text-outline/20">${icon}</span></div>`
                }
                <div class="absolute inset-0 bg-gradient-to-t from-surface-container-low via-transparent to-transparent opacity-80"></div>
            </div>
            <div class="p-5">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-headline text-lg font-bold tracking-tight text-on-surface">${this.escapeHtml(place.name)}</h3>
                    ${distText ? `<span class="text-primary text-xs font-label font-bold">${distText}</span>` : ''}
                </div>
                <p class="text-sm text-on-surface-variant line-clamp-2 mb-3 font-body leading-relaxed">${this.escapeHtml(place.description || '')}</p>
                ${this.locationStr(place) ? `<p class="text-xs text-outline mb-3 flex items-center gap-1 truncate"><span class="material-symbols-outlined text-xs">location_on</span> ${this.escapeHtml(this.locationStr(place))}</p>` : ''}
                <div class="flex items-center gap-4">
                    <span class="flex items-center gap-1.5 text-[10px] font-label uppercase tracking-wider text-outline">
                        <span class="material-symbols-outlined text-sm">${icon}</span> ${this.escapeHtml(label)}
                    </span>
                    ${place.elevation ? `<span class="flex items-center gap-1.5 text-[10px] font-label uppercase tracking-wider text-outline">
                        <span class="material-symbols-outlined text-sm">trending_up</span> ${this.escapeHtml(place.elevation)}m
                    </span>` : ''}
                    ${place.designation ? `<span class="flex items-center gap-1.5 text-[10px] font-label uppercase tracking-wider text-primary">
                        <span class="material-symbols-outlined text-sm">verified</span> ${this.escapeHtml(place.designation)}
                    </span>` : ''}
                </div>
            </div>
        </div>`;
    },

    // Saved trail card
    savedCard(place) {
        const icon = CATEGORY_ICONS[place.category] || 'place';
        const label = CATEGORY_LABELS[place.category] || place.category;

        return `
        <div class="group relative overflow-hidden rounded-xl bg-surface-container-lowest transition-all hover:translate-y-[-4px] cursor-pointer" onclick="Router.navigate('/place/${place.id}')">
            <div class="aspect-[4/5] relative">
                ${place.image_url
                    ? `<img src="${this.escapeHtml(place.image_url)}" class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" onerror="this.style.display='none'"/>`
                    : `<div class="absolute inset-0 w-full h-full flex items-center justify-center bg-surface-container-lowest"><span class="material-symbols-outlined text-6xl text-outline/20">${icon}</span></div>`
                }
                <div class="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-transparent to-transparent opacity-80"></div>
                <button onclick="event.stopPropagation(); Card.toggleSave(${place.id}, this)" class="absolute top-4 right-4 bg-surface-container-high/60 backdrop-blur-md p-2 rounded-full text-primary hover:text-error transition-colors">
                    <span class="material-symbols-outlined filled">favorite</span>
                </button>
            </div>
            <div class="p-6">
                <h3 class="font-headline text-xl font-bold mb-2">${this.escapeHtml(place.name)}</h3>
                <p class="text-on-surface-variant text-sm line-clamp-2 font-body mb-3">${this.escapeHtml(place.description || '')}</p>
                ${this.locationStr(place) ? `<p class="text-xs text-outline mb-3 flex items-center gap-1 truncate"><span class="material-symbols-outlined text-xs">location_on</span> ${this.escapeHtml(this.locationStr(place))}</p>` : ''}
                <div class="flex items-center gap-4 text-xs font-label text-outline uppercase tracking-wider">
                    <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">${icon}</span> ${this.escapeHtml(label)}</span>
                    ${place.elevation ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">filter_hdr</span> ${this.escapeHtml(place.elevation)}m</span>` : ''}
                </div>
            </div>
        </div>`;
    },

    // Toggle save/unsave
    async toggleSave(placeId, btn) {
        const icon = btn.querySelector('.material-symbols-outlined');
        const isSaved = icon.classList.contains('filled');

        try {
            if (isSaved) {
                await API.unsavePlace(placeId);
                icon.classList.remove('filled', 'text-primary');
                icon.textContent = 'bookmark';
            } else {
                await API.savePlace(placeId);
                icon.classList.add('filled', 'text-primary');
            }
        } catch (e) {
            console.error('Save toggle failed:', e);
        }
    },

    // Loading skeleton
    skeleton(count = 4) {
        return Array(count).fill(`
            <div>
                <div class="aspect-[4/5] qi-skeleton mb-6 rounded-xl"></div>
                <div class="qi-skeleton h-5 w-3/4 mb-2"></div>
                <div class="qi-skeleton h-4 w-1/2"></div>
            </div>
        `).join('');
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }
};
