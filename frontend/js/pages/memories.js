// Memories page — user photo/video journals for visited places
const MemoriesPage = {
    _memories: [],
    _editingId: null,
    _pendingFiles: [], // files awaiting quality confirmation

    async render() {
        const container = document.getElementById('page-content');
        container.innerHTML = `<div class="pt-24 pb-32 px-6 md:px-12 max-w-5xl mx-auto"><div class="flex justify-center py-12"><div class="qi-spinner"></div></div></div>`;

        try {
            const data = await API.getMemories();
            this._memories = data.memories || [];
            container.innerHTML = this.renderPage();
            this.bindEvents();
        } catch (e) {
            console.error('Memories error:', e);
            container.innerHTML = `<div class="pt-24 pb-32 px-6 text-center"><p class="text-on-surface-variant">Failed to load memories.</p></div>`;
        }
    },

    destroy() {
        this._pendingFiles = [];
        this._editingId = null;
    },

    renderPage() {
        return `
        <div class="pt-24 pb-32 px-6 md:px-12 max-w-5xl mx-auto">
            <div class="flex justify-between items-end mb-12">
                <div>
                    <span class="text-[10px] font-headline uppercase tracking-widest text-primary-dim block mb-1">Your Journal</span>
                    <h1 class="font-headline text-4xl font-extrabold tracking-tighter text-on-surface">Memories</h1>
                </div>
                <button onclick="MemoriesPage.showCreate()"
                    class="bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:scale-[1.02] transition-transform flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">add_circle</span> New Memory
                </button>
            </div>

            <!-- Create/Edit Form (hidden by default) -->
            <div id="memory-form-area" class="hidden mb-12"></div>

            <!-- Memories list -->
            <div id="memories-list">
                ${this._memories.length === 0 ? this.renderEmpty() : this._memories.map(m => this.renderMemoryCard(m)).join('')}
            </div>
        </div>

        <!-- Quality Confirmation Modal -->
        <div id="quality-modal" class="fixed inset-0 z-[200] hidden">
            <div class="absolute inset-0 bg-surface/80 backdrop-blur-md" onclick="MemoriesPage.cancelUpload()"></div>
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg bg-surface-container-low rounded-3xl border border-outline-variant/10 p-8 shadow-2xl">
                <h3 class="font-headline text-xl font-bold text-on-surface mb-2 flex items-center gap-2">
                    <span class="material-symbols-outlined text-primary">high_quality</span> Confirm Upload
                </h3>
                <p class="text-on-surface-variant text-sm mb-5">Review&nbsp;the files before uploading. Large files will be stored at original quality.</p>
                <div id="quality-preview" class="space-y-3 max-h-60 overflow-y-auto mb-6"></div>
                <div class="flex gap-3 justify-end">
                    <button onclick="MemoriesPage.cancelUpload()"
                        class="px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide text-outline border border-outline-variant/20 hover:bg-surface-container-high transition-colors">
                        Cancel
                    </button>
                    <button onclick="MemoriesPage.confirmUpload()"
                        class="bg-primary text-on-primary px-6 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:scale-[1.02] transition-transform flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">cloud_upload</span> Upload
                    </button>
                </div>
            </div>
        </div>`;
    },

    renderEmpty() {
        return `
        <div class="bg-surface-container-low rounded-3xl p-12 text-center border border-outline-variant/10">
            <span class="material-symbols-outlined text-primary text-5xl mb-6">photo_camera</span>
            <h2 class="font-headline text-2xl font-bold text-on-surface mb-4">No Memories Yet</h2>
            <p class="text-on-surface-variant font-body mb-8 max-w-md mx-auto">
                Start documenting your adventures. Upload photos, videos, and write about the places you've explored.
            </p>
            <button onclick="MemoriesPage.showCreate()"
                class="bg-primary text-on-primary px-8 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform inline-flex items-center gap-2">
                <span class="material-symbols-outlined text-sm">add_circle</span> Create Your First Memory
            </button>
        </div>`;
    },

    renderMemoryCard(m) {
        const icon = CATEGORY_ICONS[m.place_category] || 'place';
        const images = (m.media || []).filter(f => f.media_type === 'image');
        const videos = (m.media || []).filter(f => f.media_type === 'video');
        const stars = Array.from({ length: 5 }, (_, i) =>
            `<span class="material-symbols-outlined text-sm ${i < m.rating ? 'filled text-amber-400' : 'text-outline/30'}">star</span>`
        ).join('');

        return `
        <div class="bg-surface-container-low rounded-2xl border border-outline-variant/10 overflow-hidden mb-6 group" id="memory-${m.id}">
            ${images.length > 0 ? `
            <div class="relative">
                <div class="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide">
                    ${images.map(img => `
                        <div class="snap-start flex-shrink-0 w-full aspect-[16/9]">
                            <img src="/api/media/${this.esc(img.filename)}" alt="${this.esc(img.caption || img.original_name)}" class="w-full h-full object-cover"/>
                        </div>
                    `).join('')}
                </div>
                ${images.length > 1 ? `<div class="absolute bottom-3 left-1/2 -translate-x-1/2 bg-surface-container-highest/60 backdrop-blur-md rounded-full px-3 py-1 text-[10px] text-on-surface font-headline">${images.length} photos</div>` : ''}
            </div>` : ''}

            <div class="p-6">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="font-headline text-xl font-bold text-on-surface">${this.esc(m.title)}</h3>
                        ${m.place_name ? `
                        <p class="text-sm text-on-surface-variant flex items-center gap-1.5 mt-1 cursor-pointer hover:text-primary transition-colors" onclick="Router.navigate('/place/${m.place_id}')">
                            <span class="material-symbols-outlined text-sm">${icon}</span>
                            ${this.esc(m.place_name)}${m.place_county ? ` &middot; ${this.esc(m.place_county)}` : ''}
                        </p>` : ''}
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="MemoriesPage.showEdit(${m.id})" class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-primary" title="Edit">
                            <span class="material-symbols-outlined text-sm">edit</span>
                        </button>
                        <button onclick="MemoriesPage.deleteMemory(${m.id})" class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-red-400" title="Delete">
                            <span class="material-symbols-outlined text-sm">delete</span>
                        </button>
                    </div>
                </div>

                <div class="flex items-center gap-4 mb-4 text-xs text-outline">
                    ${m.rating > 0 ? `<div class="flex items-center gap-0.5">${stars}</div>` : ''}
                    ${m.visited_date ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">calendar_today</span> ${this.esc(m.visited_date)}</span>` : ''}
                    ${(m.media || []).length > 0 ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">photo_library</span> ${m.media.length} file${m.media.length !== 1 ? 's' : ''}</span>` : ''}
                </div>

                ${m.notes ? `<div class="text-on-surface-variant font-body text-sm leading-relaxed whitespace-pre-line line-clamp-4 mb-4">${this.esc(m.notes)}</div>` : ''}

                ${videos.length > 0 ? `
                <div class="space-y-3 mt-4">
                    ${videos.map(v => `
                        <video controls preload="metadata" class="w-full rounded-xl max-h-80 bg-surface-container">
                            <source src="/api/media/${this.esc(v.filename)}" />
                        </video>
                    `).join('')}
                </div>` : ''}
            </div>
        </div>`;
    },

    // --- Create / Edit Form ---

    showCreate() {
        this._editingId = null;
        const area = document.getElementById('memory-form-area');
        area.classList.remove('hidden');
        area.innerHTML = this.renderForm();
        area.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    async showEdit(id) {
        try {
            const data = await API.getMemory(id);
            this._editingId = id;
            const area = document.getElementById('memory-form-area');
            area.classList.remove('hidden');
            area.innerHTML = this.renderForm(data.memory);
            area.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            alert('Failed to load memory for editing.');
        }
    },

    renderForm(memory = null) {
        const isEdit = !!memory;
        return `
        <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
            <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                <span class="material-symbols-outlined text-primary">${isEdit ? 'edit_note' : 'add_photo_alternate'}</span>
                ${isEdit ? 'Edit Memory' : 'New Memory'}
            </h2>
            <form id="memory-form" onsubmit="MemoriesPage.saveMemory(event)" class="space-y-5">
                <div>
                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Title *</label>
                    <input name="title" type="text" required maxlength="200" value="${this.escAttr(memory?.title || '')}"
                        placeholder="e.g. Littlehampton Pier Adventure"
                        class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                </div>
                <div>
                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Link to Place</label>
                    <div class="relative">
                        <input id="place-search-input" type="text" autocomplete="off"
                            placeholder="Search for a place..." value="${this.escAttr(memory?.place_name || '')}"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                        <input type="hidden" name="place_id" id="place-id-input" value="${memory?.place_id || ''}"/>
                        <div id="place-search-results" class="absolute top-full left-0 right-0 z-30 mt-1 bg-surface-container-highest border border-outline-variant/20 rounded-xl overflow-hidden hidden max-h-48 overflow-y-auto shadow-xl"></div>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Date Visited</label>
                        <input name="visited_date" type="date" value="${this.escAttr(memory?.visited_date || '')}"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                    </div>
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Rating</label>
                        <div id="star-rating" class="flex items-center gap-1 py-2">
                            ${Array.from({ length: 5 }, (_, i) =>
                                `<button type="button" onclick="MemoriesPage.setRating(${i + 1})" class="star-btn p-1 transition-transform hover:scale-125">
                                    <span class="material-symbols-outlined text-2xl ${i < (memory?.rating || 0) ? 'filled text-amber-400' : 'text-outline/30'}">star</span>
                                </button>`
                            ).join('')}
                            <input type="hidden" name="rating" value="${memory?.rating || 0}"/>
                        </div>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Notes / Review</label>
                    <textarea name="notes" rows="5" maxlength="10000" placeholder="Write about your experience..."
                        class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all resize-y">${this.esc(memory?.notes || '')}</textarea>
                </div>

                ${isEdit ? this.renderExistingMedia(memory) : ''}

                <div id="memory-form-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                <div class="flex gap-3">
                    <button type="submit" class="bg-primary text-on-primary px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform">
                        ${isEdit ? 'Save Changes' : 'Create Memory'}
                    </button>
                    <button type="button" onclick="MemoriesPage.hideForm()"
                        class="px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide text-outline border border-outline-variant/20 hover:bg-surface-container-high transition-colors">
                        Cancel
                    </button>
                </div>
            </form>

            ${isEdit ? `
            <div class="mt-8 pt-6 border-t border-outline-variant/10">
                <h3 class="font-headline text-sm font-bold text-on-surface mb-4 flex items-center gap-2">
                    <span class="material-symbols-outlined text-primary text-base">add_a_photo</span> Add Photos & Videos
                </h3>
                <div class="flex flex-wrap gap-3">
                    <label class="cursor-pointer bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-surface-container-highest transition-colors inline-flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">photo_library</span> Choose Files
                        <input type="file" accept="image/*,video/*" multiple class="hidden" onchange="MemoriesPage.onFilesSelected(this.files)"/>
                    </label>
                    <label class="cursor-pointer bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-surface-container-highest transition-colors inline-flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">photo_camera</span> Take Photo
                        <input type="file" accept="image/*" capture="environment" class="hidden" onchange="MemoriesPage.onFilesSelected(this.files)"/>
                    </label>
                    <label class="cursor-pointer bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-surface-container-highest transition-colors inline-flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">videocam</span> Record Video
                        <input type="file" accept="video/*" capture="environment" class="hidden" onchange="MemoriesPage.onFilesSelected(this.files)"/>
                    </label>
                </div>
                <div id="upload-progress" class="hidden mt-4"></div>
            </div>` : ''}
        </div>`;
    },

    renderExistingMedia(memory) {
        if (!memory.media || memory.media.length === 0) return '';
        return `
        <div>
            <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Attached Media</label>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                ${memory.media.map(m => `
                    <div class="relative group rounded-xl overflow-hidden bg-surface-container aspect-square">
                        ${m.media_type === 'image'
                            ? `<img src="/api/media/${this.esc(m.filename)}" class="w-full h-full object-cover"/>`
                            : `<div class="w-full h-full flex items-center justify-center bg-surface-container-highest">
                                <span class="material-symbols-outlined text-3xl text-outline">videocam</span>
                               </div>`}
                        <button onclick="MemoriesPage.deleteMedia(${memory.id}, ${m.id})"
                            class="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove">
                            <span class="material-symbols-outlined text-xs">close</span>
                        </button>
                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                            <span class="text-[10px] text-white truncate block">${this.esc(m.original_name)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    },

    hideForm() {
        const area = document.getElementById('memory-form-area');
        area.classList.add('hidden');
        area.innerHTML = '';
        this._editingId = null;
    },

    // --- Place search ---

    _searchTimeout: null,

    bindEvents() {
        // Debounced place search
        document.addEventListener('input', (e) => {
            if (e.target.id === 'place-search-input') {
                clearTimeout(this._searchTimeout);
                const q = e.target.value.trim();
                if (q.length < 2) {
                    document.getElementById('place-search-results')?.classList.add('hidden');
                    return;
                }
                this._searchTimeout = setTimeout(() => this.searchPlaces(q), 300);
            }
        });
    },

    async searchPlaces(q) {
        const results = document.getElementById('place-search-results');
        if (!results) return;
        try {
            const data = await API.searchPlaces(q);
            const places = data.places || [];
            if (places.length === 0) {
                results.classList.add('hidden');
                return;
            }
            results.innerHTML = places.slice(0, 8).map(p => {
                const icon = CATEGORY_ICONS[p.category] || 'place';
                return `
                <button type="button" onclick="MemoriesPage.selectPlace(${p.id}, '${this.escAttr(p.name)}')"
                    class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-container-high transition-colors text-left">
                    <span class="material-symbols-outlined text-sm text-primary">${icon}</span>
                    <div class="min-w-0">
                        <div class="text-sm text-on-surface font-semibold truncate">${this.esc(p.name)}</div>
                        <div class="text-xs text-outline truncate">${this.esc(Card.locationStr(p))}</div>
                    </div>
                </button>`;
            }).join('');
            results.classList.remove('hidden');
        } catch {
            results.classList.add('hidden');
        }
    },

    selectPlace(id, name) {
        document.getElementById('place-id-input').value = id;
        document.getElementById('place-search-input').value = name;
        document.getElementById('place-search-results')?.classList.add('hidden');
    },

    // --- Star rating ---

    setRating(n) {
        const form = document.getElementById('memory-form');
        if (!form) return;
        form.querySelector('[name="rating"]').value = n;
        document.querySelectorAll('.star-btn .material-symbols-outlined').forEach((s, i) => {
            s.classList.toggle('filled', i < n);
            s.classList.toggle('text-amber-400', i < n);
            s.classList.toggle('text-outline/30', i >= n);
        });
    },

    // --- Save Memory ---

    async saveMemory(e) {
        e.preventDefault();
        const form = e.target;
        const msgEl = document.getElementById('memory-form-msg');

        const payload = {
            title: form.title.value.trim(),
            place_id: form.place_id.value ? parseInt(form.place_id.value) : null,
            notes: form.notes.value,
            rating: parseInt(form.rating.value) || 0,
            visited_date: form.visited_date.value,
        };

        try {
            if (this._editingId) {
                await API.updateMemory(this._editingId, payload);
            } else {
                const result = await API.createMemory(payload);
                // After creating, switch to edit mode so user can add media
                this._editingId = result.memory.id;
            }
            // Refresh
            this.render();
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    // --- Delete ---

    async deleteMemory(id) {
        if (!confirm('Delete this memory? All photos and videos will be permanently removed.')) return;
        try {
            await API.deleteMemory(id);
            this.render();
        } catch (err) {
            alert(err.message);
        }
    },

    async deleteMedia(memoryId, mediaId) {
        if (!confirm('Remove this file?')) return;
        try {
            await API.deleteMedia(memoryId, mediaId);
            // Re-open edit to refresh media list
            this.showEdit(memoryId);
        } catch (err) {
            alert(err.message);
        }
    },

    // --- File Upload with Quality Confirmation ---

    onFilesSelected(fileList) {
        if (!fileList || fileList.length === 0) return;
        this._pendingFiles = Array.from(fileList);
        this.showQualityModal();
    },

    showQualityModal() {
        const modal = document.getElementById('quality-modal');
        const preview = document.getElementById('quality-preview');
        if (!modal || !preview) return;

        preview.innerHTML = this._pendingFiles.map((f, i) => {
            const isImage = f.type.startsWith('image/');
            const isVideo = f.type.startsWith('video/');
            const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
            const icon = isImage ? 'image' : isVideo ? 'videocam' : 'attachment';
            let qualityNote = '';
            if (f.size > 20 * 1024 * 1024) {
                qualityNote = '<span class="text-amber-400">Large file — may take a moment to upload</span>';
            } else if (f.size > 5 * 1024 * 1024) {
                qualityNote = '<span class="text-primary-dim">Good quality</span>';
            } else {
                qualityNote = '<span class="text-primary">Compact</span>';
            }

            return `
            <div class="flex items-center gap-3 bg-surface-container rounded-xl p-3">
                <div class="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center flex-shrink-0">
                    ${isImage && f.size < 30 * 1024 * 1024
                        ? `<img src="${URL.createObjectURL(f)}" class="w-10 h-10 rounded-lg object-cover" onload="URL.revokeObjectURL(this.src)"/>`
                        : `<span class="material-symbols-outlined text-outline">${icon}</span>`}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-sm text-on-surface truncate font-medium">${this.esc(f.name)}</div>
                    <div class="text-xs text-outline">${sizeMB} MB &middot; ${this.esc(f.type || 'unknown')} &middot; ${qualityNote}</div>
                </div>
            </div>`;
        }).join('');

        modal.classList.remove('hidden');
    },

    cancelUpload() {
        this._pendingFiles = [];
        document.getElementById('quality-modal')?.classList.add('hidden');
    },

    async confirmUpload() {
        document.getElementById('quality-modal')?.classList.add('hidden');
        if (!this._editingId || this._pendingFiles.length === 0) return;

        const progressEl = document.getElementById('upload-progress');
        if (progressEl) {
            progressEl.classList.remove('hidden');
            progressEl.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="qi-spinner" style="width:20px;height:20px;border-width:2px"></div>
                    <span id="upload-status" class="text-sm text-on-surface-variant">Uploading 0/${this._pendingFiles.length}...</span>
                </div>`;
        }

        let uploaded = 0;
        for (const file of this._pendingFiles) {
            try {
                await API.uploadMemoryMedia(this._editingId, file);
                uploaded++;
                const status = document.getElementById('upload-status');
                if (status) status.textContent = `Uploading ${uploaded}/${this._pendingFiles.length}...`;
            } catch (err) {
                console.error('Upload failed:', err);
                const status = document.getElementById('upload-status');
                if (status) status.textContent = `Failed: ${file.name} — ${err.message}`;
            }
        }

        this._pendingFiles = [];
        if (progressEl) {
            progressEl.innerHTML = `<div class="text-sm text-primary flex items-center gap-2"><span class="material-symbols-outlined text-sm">check_circle</span> ${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded</div>`;
        }

        // Refresh the edit view to show new media
        setTimeout(() => this.showEdit(this._editingId), 500);
    },

    // --- Helpers ---

    esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },

    escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    showMsg(el, text, isError) {
        if (!el) return;
        el.classList.remove('hidden', 'text-primary', 'bg-primary/10', 'text-red-400', 'bg-red-400/10');
        el.classList.add(isError ? 'text-red-400' : 'text-primary', isError ? 'bg-red-400/10' : 'bg-primary/10');
        el.textContent = text;
    },
};
