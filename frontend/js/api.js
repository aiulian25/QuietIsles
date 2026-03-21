// API Client
const API = {
    async get(url) {
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (resp.status === 401) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) throw new Error(`API error: ${resp.status}`);
        return resp.json();
    },

    async post(url, body = {}) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        });
        if (resp.status === 401 && !url.includes('/auth/')) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            const err = new Error(data.error || `API error: ${resp.status}`);
            err.status = resp.status;
            err.data = data;
            throw err;
        }
        return resp.json();
    },

    async put(url, body = {}) {
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body),
        });
        if (resp.status === 401) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            const err = new Error(data.error || `API error: ${resp.status}`);
            err.status = resp.status;
            err.data = data;
            throw err;
        }
        return resp.json();
    },

    async del(url) {
        const resp = await fetch(url, {
            method: 'DELETE',
            credentials: 'same-origin',
        });
        if (resp.status === 401) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            const err = new Error(data.error || `API error: ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return resp.json();
    },

    // Auth
    getSetupStatus() {
        return this.get('/api/auth/setup-status');
    },
    register(data) {
        return this.post('/api/auth/register', data);
    },
    login(data) {
        return this.post('/api/auth/login', data);
    },
    logout() {
        return this.post('/api/auth/logout');
    },
    getMe() {
        return this.get('/api/auth/me');
    },
    updateProfile(data) {
        return this.put('/api/auth/profile', data);
    },

    // 2FA
    setup2FA() {
        return this.post('/api/auth/2fa/setup');
    },
    enable2FA(code) {
        return this.post('/api/auth/2fa/enable', { code });
    },
    disable2FA(password) {
        return this.post('/api/auth/2fa/disable', { password });
    },

    // Admin
    getUsers() {
        return this.get('/api/admin/users');
    },
    createUser(data) {
        return this.post('/api/admin/users', data);
    },
    deleteUser(id) {
        return this.del(`/api/admin/users/${id}`);
    },
    disableUser(id) {
        return this.post(`/api/admin/users/${id}/disable`);
    },
    enableUser(id) {
        return this.post(`/api/admin/users/${id}/enable`);
    },

    // Places
    getPlaces(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.get(`/api/places?${qs}`);
    },

    getFeatured() {
        return this.get('/api/places/featured');
    },

    getPlace(id) {
        return this.get(`/api/places/${id}`);
    },

    searchPlaces(q) {
        return this.get(`/api/places/search?q=${encodeURIComponent(q)}`);
    },

    getCategories() {
        return this.get('/api/categories');
    },

    // Saved
    getSaved() {
        return this.get('/api/saved');
    },

    savePlace(id) {
        return this.post(`/api/saved/${id}`);
    },

    unsavePlace(id) {
        return this.del(`/api/saved/${id}`);
    },

    // Sync
    triggerSync() {
        return this.post('/api/sync');
    },

    getSyncStatus() {
        return this.get('/api/sync/status');
    },

    getStats() {
        return this.get('/api/stats');
    },

    // Interests
    getInterests() {
        return this.get('/api/auth/interests');
    },
    updateInterests(interests) {
        return this.put('/api/auth/interests', { interests });
    },

    // Personalised
    getForYou(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.get(`/api/places/for-you?${qs}`);
    },
    getSurprise(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.get(`/api/places/surprise?${qs}`);
    },

    // Memories
    getMemories() {
        return this.get('/api/memories');
    },
    getMemory(id) {
        return this.get(`/api/memories/${id}`);
    },
    createMemory(data) {
        return this.post('/api/memories', data);
    },
    updateMemory(id, data) {
        return this.put(`/api/memories/${id}`, data);
    },
    deleteMemory(id) {
        return this.del(`/api/memories/${id}`);
    },
    deleteMedia(memoryId, mediaId) {
        return this.del(`/api/memories/${memoryId}/media/${mediaId}`);
    },
    async uploadMemoryMedia(memoryId, file, caption = '') {
        const formData = new FormData();
        formData.append('file', file);
        if (caption) formData.append('caption', caption);
        const resp = await fetch(`/api/memories/${memoryId}/media`, {
            method: 'POST',
            credentials: 'same-origin',
            body: formData,
        });
        if (resp.status === 401) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `Upload failed: ${resp.status}`);
        }
        return resp.json();
    },

    // Backups
    getBackupSettings() {
        return this.get('/api/backups/settings');
    },
    updateBackupSettings(data) {
        return this.put('/api/backups/settings', data);
    },
    getBackups() {
        return this.get('/api/backups');
    },
    createBackup() {
        return this.post('/api/backups');
    },
    deleteBackup(filename) {
        return this.del(`/api/backups/${encodeURIComponent(filename)}`);
    },
    async restoreBackup(filename) {
        return this.post(`/api/backups/${encodeURIComponent(filename)}/restore`);
    },
    async uploadBackup(file) {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/backups/upload', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData,
        });
        if (resp.status === 401) {
            Auth.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `Upload failed: ${resp.status}`);
        }
        return resp.json();
    },
};

// Auth state
const Auth = {
    user: null,

    handleUnauthorized() {
        this.user = null;
        if (window.location.pathname !== '/login') {
            Router.navigate('/login');
        }
    },

    async check() {
        try {
            const data = await API.getSetupStatus();
            if (data.needs_setup) {
                this.user = null;
                return 'setup';
            }
            if (data.authenticated && data.user) {
                this.user = data.user;
                return 'authenticated';
            }
            this.user = null;
            return 'unauthenticated';
        } catch {
            this.user = null;
            return 'unauthenticated';
        }
    },

    isAdmin() {
        return this.user && this.user.role === 'admin';
    },
};

// User location helper
const GeoHelper = {
    _position: null,

    getPosition() {
        return new Promise((resolve) => {
            if (this._position) {
                resolve(this._position);
                return;
            }
            if (!navigator.geolocation) {
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this._position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                    resolve(this._position);
                },
                () => resolve(null),
                { timeout: 10000, maximumAge: 300000 }
            );
        });
    },

    // Calculate distance between two points (km)
    distance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
};

// Category icon mapping
const CATEGORY_ICONS = {
    peak: 'terrain',
    beach: 'beach_access',
    waterfall: 'water_drop',
    cliff: 'landscape',
    viewpoint: 'visibility',
    nature_reserve: 'forest',
    national_park: 'park',
    wood: 'forest',
    heath: 'grass',
    moor: 'grass',
    aonb: 'landscape_2',
    sssi: 'eco',
    national_trail: 'hiking',
};

const CATEGORY_LABELS = {
    peak: 'Peak',
    beach: 'Beach',
    waterfall: 'Waterfall',
    cliff: 'Cliff',
    viewpoint: 'Viewpoint',
    nature_reserve: 'Nature Reserve',
    national_park: 'National Park',
    wood: 'Woodland',
    heath: 'Heathland',
    moor: 'Moorland',
    aonb: 'National Landscape',
    sssi: 'SSSI',
    national_trail: 'National Trail',
};
