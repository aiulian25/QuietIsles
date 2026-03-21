// SPA Router & App initialization
const Router = {
    currentPage: null,

    routes: [
        { path: /^\/$/, page: 'home', render: () => HomePage.render(), auth: true },
        { path: /^\/explore$/, page: 'explore', render: () => ExplorePage.render(), auth: true },
        { path: /^\/saved$/, page: 'saved', render: () => SavedPage.render(), auth: true },
        { path: /^\/memories$/, page: 'memories', render: () => MemoriesPage.render(), auth: true },
        { path: /^\/settings$/, page: 'settings', render: () => SettingsPage.render(), auth: true },
        { path: /^\/place\/(\d+)$/, page: 'detail', render: (match) => DetailPage.render(parseInt(match[1])), auth: true },
        { path: /^\/login$/, page: 'login', render: () => LoginPage.render(), auth: false },
    ],

    async init() {
        // Handle link clicks
        document.addEventListener('click', (e) => {
            const link = e.target.closest('[data-link]');
            if (link) {
                e.preventDefault();
                const href = link.getAttribute('href');
                if (href) this.navigate(href);
            }
        });

        // Handle browser back/forward
        window.addEventListener('popstate', () => this.handleRoute());

        // Setup search
        this.setupSearch();

        // Check auth and initial route
        await this.handleRoute();
    },

    navigate(path) {
        if (path === window.location.pathname) return;
        window.history.pushState(null, '', path);
        this.handleRoute();
    },

    async handleRoute() {
        const path = window.location.pathname;

        // Cleanup previous page
        if (this.currentPage === 'explore') {
            ExplorePage.destroy();
        }
        if (this.currentPage === 'detail') {
            DetailPage.destroy();
        }
        if (this.currentPage === 'login') {
            LoginPage.destroy();
        }
        if (this.currentPage === 'memories') {
            MemoriesPage.destroy();
        }
        if (this.currentPage === 'settings') {
            SettingsPage.destroy();
        }

        // Find matching route
        for (const route of this.routes) {
            const match = path.match(route.path);
            if (match) {
                // Check auth for protected routes
                if (route.auth) {
                    const authState = await Auth.check();
                    if (authState === 'setup') {
                        LoginPage.destroy = LoginPage.destroy || (() => {});
                        this.currentPage = 'login';
                        window.history.replaceState(null, '', '/login');
                        Nav.updateActive('login');
                        LoginPage.render();
                        return;
                    }
                    if (authState !== 'authenticated') {
                        this.currentPage = 'login';
                        window.history.replaceState(null, '', '/login');
                        Nav.updateActive('login');
                        LoginPage.render();
                        return;
                    }
                    // Show nav elements
                    document.getElementById('sidebar')?.classList.remove('!hidden');
                    document.getElementById('mobile-nav')?.classList.remove('!hidden');
                    document.getElementById('topbar')?.classList.remove('!hidden');
                }

                // If on login page and already authenticated, redirect home
                if (route.page === 'login') {
                    const authState = await Auth.check();
                    if (authState === 'authenticated') {
                        this.navigate('/');
                        return;
                    }
                }

                this.currentPage = route.page;
                Nav.updateActive(route.page);

                // Scroll to top
                window.scrollTo(0, 0);

                // Animate transition
                const content = document.getElementById('page-content');
                if (content) {
                    content.style.animation = 'none';
                    content.offsetHeight; // trigger reflow
                    content.style.animation = 'fadeIn 0.3s ease-out';
                }

                route.render(match);
                return;
            }
        }

        // 404 - redirect to home
        this.navigate('/');
    },

    setupSearch() {
        const toggle = document.getElementById('search-toggle');
        const overlay = document.getElementById('search-overlay');
        const input = document.getElementById('search-input');
        const close = document.getElementById('search-close');
        const results = document.getElementById('search-results');

        if (toggle) {
            toggle.addEventListener('click', () => {
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                setTimeout(() => input.focus(), 100);
            });
        }

        if (close) {
            close.addEventListener('click', () => {
                overlay.classList.add('hidden');
                overlay.classList.remove('flex');
                input.value = '';
                results.innerHTML = '';
            });
        }

        if (input) {
            let timeout;
            input.addEventListener('input', () => {
                clearTimeout(timeout);
                timeout = setTimeout(async () => {
                    const q = input.value.trim();
                    if (q.length < 2) {
                        results.innerHTML = '';
                        return;
                    }

                    try {
                        const data = await API.searchPlaces(q);
                        const places = data.places || [];

                        if (places.length === 0) {
                            results.innerHTML = '<p class="text-outline text-center py-8">No places found.</p>';
                            return;
                        }

                        results.innerHTML = places.map(p => `
                            <div class="flex items-center gap-4 p-4 bg-surface-container-low rounded-xl cursor-pointer hover:bg-surface-container-high transition-colors"
                                 onclick="document.getElementById('search-overlay').classList.add('hidden'); document.getElementById('search-overlay').classList.remove('flex'); Router.navigate('/place/${p.id}')">
                                <div class="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-primary">${CATEGORY_ICONS[p.category] || 'place'}</span>
                                </div>
                                <div class="overflow-hidden">
                                    <div class="font-headline font-bold text-sm truncate">${Card.escapeHtml(p.name)}</div>
                                    <div class="text-xs text-outline truncate">${Card.escapeHtml(p.county || p.city || p.region || CATEGORY_LABELS[p.category] || '')}</div>
                                </div>
                            </div>
                        `).join('');
                    } catch (e) {
                        results.innerHTML = '<p class="text-outline text-center py-8">Search failed.</p>';
                    }
                }, 300);
            });

            // Close on Escape
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                }
            });
        }
    },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    Router.init();
});

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}
