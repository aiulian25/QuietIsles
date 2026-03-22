// Settings page
const SettingsPage = {
    _syncPoll: null,

    async render() {
        const container = document.getElementById('page-content');
        container.innerHTML = `<div class="pt-24 pb-32 px-6 md:px-12 max-w-4xl mx-auto"><div class="flex justify-center py-12"><div class="qi-spinner"></div></div></div>`;

        try {
            const user = Auth.user;
            if (!user) { Router.navigate('/login'); return; }
            this._selectedInterests = new Set(user.interests || []);
            container.innerHTML = this.renderPage(user);
            this.bindEvents();
            if (Auth.isAdmin()) {
                this.loadUsers();
                this.loadBackupSettings();
                this.loadBackupList();
            }
            this.pollSyncStatus();
        } catch (e) {
            console.error('Settings error:', e);
            container.innerHTML = `<div class="pt-24 pb-32 px-6 text-center"><p class="text-on-surface-variant">Failed to load settings.</p></div>`;
        }
    },

    destroy() {
        if (this._syncPoll) { clearInterval(this._syncPoll); this._syncPoll = null; }
    },

    renderPage(user) {
        return `
        <div class="pt-24 pb-32 px-6 md:px-12 max-w-4xl mx-auto">
            <div class="mb-12">
                <span class="text-[10px] font-headline uppercase tracking-widest text-primary-dim block mb-1">Account</span>
                <h1 class="font-headline text-4xl font-extrabold tracking-tighter text-on-surface">Settings</h1>
            </div>

            <!-- Profile Section -->
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">person</span> Profile
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10 space-y-5">
                    <div class="flex items-center gap-4 mb-4">
                        <div class="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center">
                            <span class="material-symbols-outlined text-primary text-2xl">person</span>
                        </div>
                        <div>
                            <div class="font-headline font-bold text-on-surface">${this.esc(user.display_name)}</div>
                            <div class="text-sm text-outline">@${this.esc(user.username)} &middot; <span class="capitalize text-primary-dim">${this.esc(user.role)}</span></div>
                        </div>
                    </div>
                    <form id="profile-form" onsubmit="SettingsPage.saveProfile(event)" class="space-y-4">
                        <div>
                            <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Display Name</label>
                            <input name="display_name" type="text" value="${this.escAttr(user.display_name)}"
                                class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                        </div>
                        <div>
                            <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Current Password</label>
                            <input name="current_password" type="password" autocomplete="current-password"
                                class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                placeholder="Required to change password"/>
                        </div>
                        <div>
                            <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">New Password</label>
                            <input name="new_password" type="password" minlength="8" autocomplete="new-password"
                                class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                                placeholder="Leave empty to keep current"/>
                        </div>
                        <div id="profile-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                        <button type="submit" class="bg-primary text-on-primary px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform">
                            Save Profile
                        </button>
                    </form>
                </div>
            </section>

            <!-- 2FA Section -->
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">interests</span> Interests
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                    <p class="text-on-surface-variant text-sm mb-5">Pick the landscapes you love. We'll suggest places based on your interests.</p>
                    <div id="interests-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-5">
                        ${Object.keys(CATEGORY_ICONS).map(key => {
                            const active = (user.interests || []).includes(key);
                            return `
                            <button type="button" data-cat="${key}" onclick="SettingsPage.toggleInterest('${key}')"
                                class="interest-chip flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-headline font-semibold transition-all
                                    ${active
                                        ? 'bg-primary/20 border-primary/40 text-primary'
                                        : 'bg-surface-container border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30'}">
                                <span class="material-symbols-outlined text-base">${CATEGORY_ICONS[key]}</span>
                                ${CATEGORY_LABELS[key] || key}
                            </button>`;
                        }).join('')}
                    </div>
                    <div id="interests-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                    <button onclick="SettingsPage.saveInterests()"
                        class="bg-primary text-on-primary px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform">
                        Save Interests
                    </button>
                </div>
            </section>

            <!-- Two-Factor Authentication Section -->
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">security</span> Two-Factor Authentication
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                    <div id="2fa-content">
                        ${user.totp_enabled ? this.render2FAEnabled() : this.render2FADisabled()}
                    </div>
                </div>
            </section>

            <!-- Data Sync Section -->
            ${Auth.isAdmin() ? `
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">sync</span> Data Sync
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                    <p class="text-on-surface-variant text-sm mb-4">Sync landscape data from OpenStreetMap, Natural England, and NatureScot. This fetches places, images, descriptions, and geocoding data.</p>
                    <div id="sync-section">
                        <button id="settings-sync-btn" onclick="SettingsPage.startSync()"
                            class="bg-primary text-on-primary px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:scale-[1.02] transition-transform flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">sync</span> Start Full Sync
                        </button>
                        <button id="settings-sync-cancel-btn" onclick="SettingsPage.cancelSync()"
                            class="hidden bg-red-500/20 text-red-400 border border-red-500/30 px-6 py-3 rounded-full font-headline font-bold text-sm tracking-wide hover:bg-red-500/30 transition-all flex items-center gap-2 mt-3">
                            <span class="material-symbols-outlined text-sm">stop_circle</span> Stop Sync
                        </button>
                        <div id="sync-progress-area" class="hidden mt-6">
                            <div class="flex items-center justify-between mb-2">
                                <span id="sync-progress-msg" class="text-sm text-on-surface-variant">Starting...</span>
                                <span id="sync-progress-pct" class="text-sm text-primary font-bold">0%</span>
                            </div>
                            <div class="w-full bg-surface-container-highest rounded-full h-2 overflow-hidden">
                                <div id="sync-progress-bar" class="bg-gradient-to-r from-primary to-primary-container h-full rounded-full transition-all duration-500" style="width: 0%"></div>
                            </div>
                        </div>
                        <div id="sync-errors" class="hidden mt-4"></div>
                    </div>
                </div>
            </section>` : ''}

            <!-- Backups (Admin only) -->
            ${Auth.isAdmin() ? `
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">backup</span> Backups
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10 space-y-6">
                    <p class="text-on-surface-variant text-sm">Back up all data including user accounts, settings, 2FA, saved places, memories, and uploaded media.</p>

                    <!-- Schedule Settings -->
                    <div class="bg-surface-container rounded-xl p-5 border border-outline-variant/10 space-y-4">
                        <h3 class="font-headline font-bold text-sm text-on-surface flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm text-primary">schedule</span> Automatic Backups
                        </h3>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Schedule</label>
                                <select id="backup-schedule" onchange="SettingsPage.saveBackupSettings()"
                                    class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all text-sm">
                                    <option value="off">Off</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Keep Max Backups</label>
                                <input id="backup-max" type="number" min="1" max="100" value="5"
                                    onchange="SettingsPage.saveBackupSettings()"
                                    class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all text-sm"/>
                            </div>
                            <div>
                                <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Delete After (Days)</label>
                                <input id="backup-retention" type="number" min="0" max="3650" value="90" placeholder="0 = forever"
                                    onchange="SettingsPage.saveBackupSettings()"
                                    class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all text-sm"/>
                            </div>
                        </div>
                        <div id="backup-schedule-info" class="text-xs text-outline"></div>
                        <div id="backup-settings-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                    </div>

                    <!-- Actions -->
                    <div class="flex flex-wrap gap-3">
                        <button id="backup-create-btn" onclick="SettingsPage.createBackup()"
                            class="bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:scale-[1.02] transition-transform flex items-center gap-2">
                            <span class="material-symbols-outlined text-sm">add</span> Create Backup Now
                        </button>
                        <label class="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-surface-container-highest transition-colors flex items-center gap-2 cursor-pointer">
                            <span class="material-symbols-outlined text-sm">upload_file</span> Upload Backup
                            <input type="file" accept=".zip" class="hidden" onchange="SettingsPage.uploadBackup(event)"/>
                        </label>
                    </div>
                    <div id="backup-action-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>

                    <!-- Backup List -->
                    <div id="backup-list">
                        <div class="flex justify-center py-4"><div class="qi-spinner" style="width:24px;height:24px;border-width:2px"></div></div>
                    </div>
                </div>
            </section>` : ''}

            <!-- User Management (Admin only) -->
            ${Auth.isAdmin() ? `
            <section class="mb-12">
                <h2 class="font-headline text-xl font-bold text-on-surface mb-6 flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary">group</span> User Management
                </h2>
                <div class="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/10">
                    <p class="text-on-surface-variant text-sm mb-4">Public registration is disabled. Create and manage users here.</p>
                    <button onclick="SettingsPage.showCreateUser()"
                        class="bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:scale-[1.02] transition-transform flex items-center gap-2 mb-6">
                        <span class="material-symbols-outlined text-sm">person_add</span> Create User
                    </button>
                    <div id="create-user-form" class="hidden mb-6 bg-surface-container rounded-xl p-5 border border-outline-variant/10">
                        <form onsubmit="SettingsPage.createUser(event)" class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Username</label>
                                    <input name="username" type="text" required
                                        class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                                </div>
                                <div>
                                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Display Name</label>
                                    <input name="display_name" type="text"
                                        class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Password</label>
                                    <input name="password" type="password" required minlength="8"
                                        class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                                </div>
                                <div>
                                    <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Role</label>
                                    <select name="role" class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all">
                                        <option value="user">User</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div id="create-user-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                            <div class="flex gap-3">
                                <button type="submit" class="bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide">Create</button>
                                <button type="button" onclick="document.getElementById('create-user-form').classList.add('hidden')" class="px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide text-outline border border-outline-variant/20 hover:bg-surface-container-high">Cancel</button>
                            </div>
                        </form>
                    </div>
                    <div id="users-list">
                        <div class="flex justify-center py-4"><div class="qi-spinner" style="width:24px;height:24px;border-width:2px"></div></div>
                    </div>
                </div>
            </section>` : ''}

            <!-- Logout -->
            <section class="mb-12">
                <button onclick="SettingsPage.logout()"
                    class="flex items-center gap-3 text-red-400 hover:text-red-300 transition-colors font-headline font-bold text-sm">
                    <span class="material-symbols-outlined">logout</span> Sign out
                </button>
            </section>
        </div>`;
    },

    render2FADisabled() {
        return `
            <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-full bg-outline/10 flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-outline">shield</span>
                </div>
                <div class="flex-1">
                    <p class="text-on-surface font-semibold mb-1">2FA is off</p>
                    <p class="text-on-surface-variant text-sm mb-4">Add an extra layer of security to your account using an authenticator app.</p>
                    <button onclick="SettingsPage.setup2FA()"
                        class="bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:scale-[1.02] transition-transform">
                        Enable 2FA
                    </button>
                </div>
            </div>`;
    },

    render2FAEnabled() {
        return `
            <div class="flex items-start gap-4">
                <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-primary filled">verified_user</span>
                </div>
                <div class="flex-1">
                    <p class="text-on-surface font-semibold mb-1">2FA is active</p>
                    <p class="text-on-surface-variant text-sm mb-4">Your account is protected with two-factor authentication.</p>
                    <div class="flex flex-wrap gap-3">
                        <a href="/api/auth/2fa/backup-codes.pdf" target="_blank"
                            class="inline-flex items-center gap-2 bg-surface-container-high text-on-surface px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-surface-container-highest transition-colors">
                            <span class="material-symbols-outlined text-sm">download</span> Download Backup Codes (PDF)
                        </a>
                        <button onclick="SettingsPage.disable2FA()"
                            class="inline-flex items-center gap-2 text-red-400 border border-red-400/30 px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide hover:bg-red-400/10 transition-colors">
                            <span class="material-symbols-outlined text-sm">shield</span> Disable 2FA
                        </button>
                    </div>
                </div>
            </div>`;
    },

    bindEvents() {},

    // --- Profile ---
    async saveProfile(e) {
        e.preventDefault();
        const form = e.target;
        const msgEl = document.getElementById('profile-msg');

        const data = { display_name: form.display_name.value.trim() };
        if (form.new_password.value) {
            data.current_password = form.current_password.value;
            data.new_password = form.new_password.value;
        }

        try {
            const result = await API.updateProfile(data);
            Auth.user = result.user;
            this.showMsg(msgEl, 'Profile updated successfully.', false);
            form.current_password.value = '';
            form.new_password.value = '';
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    // --- Interests ---
    _selectedInterests: new Set(),

    toggleInterest(key) {
        if (this._selectedInterests.has(key)) {
            this._selectedInterests.delete(key);
        } else {
            this._selectedInterests.add(key);
        }
        const btn = document.querySelector(`[data-cat="${key}"]`);
        if (btn) {
            const active = this._selectedInterests.has(key);
            btn.className = `interest-chip flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-headline font-semibold transition-all ${
                active
                    ? 'bg-primary/20 border-primary/40 text-primary'
                    : 'bg-surface-container border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30'
            }`;
        }
    },

    async saveInterests() {
        const msgEl = document.getElementById('interests-msg');
        try {
            const result = await API.updateInterests([...this._selectedInterests]);
            Auth.user.interests = result.interests;
            this.showMsg(msgEl, 'Interests saved.', false);
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    // --- 2FA ---
    async setup2FA() {
        const content = document.getElementById('2fa-content');
        try {
            const data = await API.setup2FA();
            content.innerHTML = `
                <div class="space-y-5">
                    <p class="text-on-surface-variant text-sm">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code below.</p>
                    <div class="flex justify-center py-4">
                        <div class="bg-white p-4 rounded-xl inline-block">
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.uri)}" alt="QR Code" class="w-48 h-48"/>
                        </div>
                    </div>
                    <div class="bg-surface-container rounded-xl p-4">
                        <p class="text-xs text-outline mb-1">Manual entry key:</p>
                        <code class="text-sm text-primary font-mono break-all select-all">${this.esc(data.secret)}</code>
                    </div>
                    <form onsubmit="SettingsPage.verify2FA(event)" class="flex gap-3 items-end">
                        <div class="flex-1">
                            <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Verification Code</label>
                            <input name="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" required
                                class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none font-mono text-center text-lg tracking-widest"/>
                        </div>
                        <button type="submit" class="bg-primary text-on-primary px-5 py-3 rounded-full font-headline font-bold text-xs tracking-wide whitespace-nowrap">Verify & Enable</button>
                    </form>
                    <div id="2fa-setup-msg" class="hidden text-sm rounded-xl px-4 py-3"></div>
                </div>`;
        } catch (err) {
            content.innerHTML = `<p class="text-red-400 text-sm">${this.esc(err.message)}</p>`;
        }
    },

    async verify2FA(e) {
        e.preventDefault();
        const msgEl = document.getElementById('2fa-setup-msg');
        const code = e.target.code.value.trim();

        try {
            const data = await API.enable2FA(code);
            Auth.user.totp_enabled = true;
            const content = document.getElementById('2fa-content');
            content.innerHTML = `
                <div class="space-y-5">
                    <div class="flex items-center gap-3 text-primary">
                        <span class="material-symbols-outlined filled">check_circle</span>
                        <span class="font-semibold">2FA enabled successfully!</span>
                    </div>
                    <p class="text-on-surface-variant text-sm">Save these backup codes in a safe place. Each code can only be used once.</p>
                    <div class="grid grid-cols-2 gap-2 bg-surface-container rounded-xl p-4">
                        ${data.backup_codes.map((c, i) => `<div class="font-mono text-sm text-on-surface py-1"><span class="text-outline mr-2">${i + 1}.</span>${c}</div>`).join('')}
                    </div>
                    <div class="flex flex-wrap gap-3">
                        <a href="/api/auth/2fa/backup-codes.pdf" target="_blank"
                            class="inline-flex items-center gap-2 bg-primary text-on-primary px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide">
                            <span class="material-symbols-outlined text-sm">download</span> Download as PDF
                        </a>
                        <button onclick="SettingsPage.render()"
                            class="px-5 py-2.5 rounded-full font-headline font-bold text-xs tracking-wide text-outline border border-outline-variant/20 hover:bg-surface-container-high">
                            Done
                        </button>
                    </div>
                </div>`;
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    async disable2FA() {
        const password = prompt('Enter your password to disable 2FA:');
        if (!password) return;
        try {
            await API.disable2FA(password);
            Auth.user.totp_enabled = false;
            document.getElementById('2fa-content').innerHTML = this.render2FADisabled();
        } catch (err) {
            alert(err.message);
        }
    },

    // --- Sync ---
    async startSync() {
        const btn = document.getElementById('settings-sync-btn');
        const cancelBtn = document.getElementById('settings-sync-cancel-btn');
        const area = document.getElementById('sync-progress-area');
        if (btn) btn.disabled = true;
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (area) area.classList.remove('hidden');

        try {
            await API.triggerSync();
            this.pollSyncStatus();
        } catch (err) {
            this.showSyncError(err.message);
            if (btn) btn.disabled = false;
            if (cancelBtn) cancelBtn.classList.add('hidden');
        }
    },

    async cancelSync() {
        const cancelBtn = document.getElementById('settings-sync-cancel-btn');
        if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = 'Cancelling...'; }
        try {
            await API.cancelSync();
        } catch (err) {
            this.showSyncError(err.message);
        }
    },

    pollSyncStatus() {
        if (this._syncPoll) clearInterval(this._syncPoll);
        this._syncPoll = setInterval(async () => {
            try {
                const s = await API.getSyncStatus();
                const btn = document.getElementById('settings-sync-btn');
                const cancelBtn = document.getElementById('settings-sync-cancel-btn');
                const area = document.getElementById('sync-progress-area');
                const msg = document.getElementById('sync-progress-msg');
                const pct = document.getElementById('sync-progress-pct');
                const bar = document.getElementById('sync-progress-bar');
                const errArea = document.getElementById('sync-errors');

                if (!area) { clearInterval(this._syncPoll); this._syncPoll = null; return; }

                if (s.running) {
                    area.classList.remove('hidden');
                    if (btn) btn.disabled = true;
                    if (cancelBtn) cancelBtn.classList.remove('hidden');
                    if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.innerHTML = '<span class="material-symbols-outlined text-sm">stop_circle</span> Stop Sync'; }
                    if (msg) msg.textContent = s.message || 'Syncing...';
                    if (pct) pct.textContent = `${s.progress || 0}%`;
                    if (bar) bar.style.width = `${s.progress || 0}%`;
                } else if (s.progress >= 100) {
                    if (msg) msg.textContent = s.message || 'Sync complete!';
                    if (pct) pct.textContent = '100%';
                    if (bar) bar.style.width = '100%';
                    if (btn) { btn.disabled = false; }
                    if (cancelBtn) cancelBtn.classList.add('hidden');
                    clearInterval(this._syncPoll); this._syncPoll = null;
                } else {
                    if (btn) btn.disabled = false;
                    if (cancelBtn) cancelBtn.classList.add('hidden');
                    area.classList.add('hidden');
                    clearInterval(this._syncPoll); this._syncPoll = null;
                }

                // Show errors if any
                if (s.errors && s.errors.length > 0 && errArea) {
                    errArea.classList.remove('hidden');
                    errArea.innerHTML = `
                        <div class="bg-red-400/10 border border-red-400/20 rounded-xl p-4">
                            <div class="flex items-center gap-2 text-red-400 font-semibold text-sm mb-2">
                                <span class="material-symbols-outlined text-sm">error</span> Sync Errors
                            </div>
                            ${s.errors.map(e => `<p class="text-red-300 text-xs">${this.esc(e)}</p>`).join('')}
                        </div>`;
                }
            } catch {
                clearInterval(this._syncPoll); this._syncPoll = null;
            }
        }, 2000);
    },

    showSyncError(msg) {
        const errArea = document.getElementById('sync-errors');
        if (errArea) {
            errArea.classList.remove('hidden');
            errArea.innerHTML = `
                <div class="bg-red-400/10 border border-red-400/20 rounded-xl p-4">
                    <p class="text-red-400 text-sm">${this.esc(msg)}</p>
                </div>`;
        }
    },

    // --- User Management ---
    showCreateUser() {
        document.getElementById('create-user-form')?.classList.remove('hidden');
    },

    async createUser(e) {
        e.preventDefault();
        const form = e.target;
        const msgEl = document.getElementById('create-user-msg');

        try {
            await API.createUser({
                username: form.username.value.trim(),
                password: form.password.value,
                display_name: form.display_name.value.trim(),
                role: form.role.value,
            });
            form.reset();
            document.getElementById('create-user-form')?.classList.add('hidden');
            this.loadUsers();
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    async loadUsers() {
        const container = document.getElementById('users-list');
        if (!container) return;
        try {
            const data = await API.getUsers();
            const users = data.users || [];
            if (users.length === 0) {
                container.innerHTML = '<p class="text-outline text-sm">No users.</p>';
                return;
            }
            container.innerHTML = `
                <div class="divide-y divide-outline-variant/10">
                    ${users.map(u => `
                        <div class="flex items-center justify-between py-4 ${!u.is_active ? 'opacity-50' : ''}">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-full ${u.role === 'admin' ? 'bg-primary/20' : 'bg-surface-container-high'} flex items-center justify-center">
                                    <span class="material-symbols-outlined text-sm ${u.role === 'admin' ? 'text-primary' : 'text-outline'}">${u.role === 'admin' ? 'admin_panel_settings' : 'person'}</span>
                                </div>
                                <div>
                                    <div class="font-headline font-bold text-sm text-on-surface">${this.esc(u.display_name)}</div>
                                    <div class="text-xs text-outline">@${this.esc(u.username)} &middot; ${this.esc(u.role)} ${u.totp_enabled ? '&middot; <span class="text-primary">2FA</span>' : ''} ${!u.is_active ? '&middot; <span class="text-red-400">Disabled</span>' : ''}</div>
                                </div>
                            </div>
                            ${u.id !== Auth.user.id ? `
                                <div class="flex items-center gap-2">
                                    ${u.is_active
                                        ? `<button onclick="SettingsPage.toggleUser(${u.id}, false)" class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-yellow-400" title="Disable user"><span class="material-symbols-outlined text-sm">block</span></button>`
                                        : `<button onclick="SettingsPage.toggleUser(${u.id}, true)" class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-primary" title="Enable user"><span class="material-symbols-outlined text-sm">check_circle</span></button>`
                                    }
                                    <button onclick="SettingsPage.deleteUser(${u.id}, '${this.escAttr(u.username)}')" class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-red-400" title="Delete user"><span class="material-symbols-outlined text-sm">delete</span></button>
                                </div>
                            ` : '<span class="text-xs text-primary-dim font-medium">You</span>'}
                        </div>
                    `).join('')}
                </div>`;
        } catch (err) {
            container.innerHTML = `<p class="text-red-400 text-sm">${this.esc(err.message)}</p>`;
        }
    },

    async toggleUser(id, enable) {
        try {
            if (enable) await API.enableUser(id);
            else await API.disableUser(id);
            this.loadUsers();
        } catch (err) {
            alert(err.message);
        }
    },

    async deleteUser(id, username) {
        if (!confirm(`Delete user @${username}? This will permanently remove all their data including saved places.`)) return;
        try {
            await API.deleteUser(id);
            this.loadUsers();
        } catch (err) {
            alert(err.message);
        }
    },

    // --- Logout ---
    async logout() {
        try {
            await API.logout();
        } catch {}
        Auth.user = null;
        Router.navigate('/login');
    },

    // --- Backups ---
    async loadBackupSettings() {
        try {
            const data = await API.getBackupSettings();
            const s = data.settings;
            const schedule = document.getElementById('backup-schedule');
            const max = document.getElementById('backup-max');
            const retention = document.getElementById('backup-retention');
            const info = document.getElementById('backup-schedule-info');
            if (schedule) schedule.value = s.schedule || 'off';
            if (max) max.value = s.max_backups || 5;
            if (retention) retention.value = s.retention_days || 0;
            if (info) {
                const parts = [];
                if (s.last_backup) parts.push(`Last backup: ${s.last_backup}`);
                if (s.next_backup && s.schedule !== 'off') parts.push(`Next: ${s.next_backup}`);
                info.textContent = parts.join(' · ') || '';
            }
        } catch {}
    },

    async saveBackupSettings() {
        const msgEl = document.getElementById('backup-settings-msg');
        try {
            const schedule = document.getElementById('backup-schedule')?.value || 'off';
            const max_backups = parseInt(document.getElementById('backup-max')?.value) || 5;
            const retention_days = parseInt(document.getElementById('backup-retention')?.value) || 0;
            const data = await API.updateBackupSettings({ schedule, max_backups, retention_days });
            const info = document.getElementById('backup-schedule-info');
            if (info) {
                const s = data.settings;
                const parts = [];
                if (s.last_backup) parts.push(`Last backup: ${s.last_backup}`);
                if (s.next_backup && s.schedule !== 'off') parts.push(`Next: ${s.next_backup}`);
                info.textContent = parts.join(' · ') || '';
            }
            this.showMsg(msgEl, 'Backup settings saved.', false);
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    async loadBackupList() {
        const container = document.getElementById('backup-list');
        if (!container) return;
        try {
            const data = await API.getBackups();
            const backups = data.backups || [];
            if (backups.length === 0) {
                container.innerHTML = '<p class="text-outline text-sm">No backups yet.</p>';
                return;
            }
            container.innerHTML = `
                <div class="divide-y divide-outline-variant/10">
                    ${backups.map(b => `
                        <div class="flex items-center justify-between py-4 gap-4">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-10 h-10 rounded-full ${b.label === 'manual' || b.label === '' ? 'bg-primary/20' : 'bg-surface-container-high'} flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-sm ${b.label && b.label.startsWith('auto') ? 'text-outline' : 'text-primary'}">${b.label && b.label.startsWith('auto') ? 'schedule' : 'backup'}</span>
                                </div>
                                <div class="min-w-0">
                                    <div class="font-headline font-bold text-sm text-on-surface truncate">${this.esc(b.created_at)}</div>
                                    <div class="text-xs text-outline">${this._formatSize(b.size)} · ${b.media_count} media file${b.media_count !== 1 ? 's' : ''} · ${this.esc(b.label || 'manual')}</div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 flex-shrink-0">
                                <a href="/api/backups/${encodeURIComponent(b.filename)}/download" 
                                    class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-primary" title="Download">
                                    <span class="material-symbols-outlined text-sm">download</span>
                                </a>
                                <button onclick="SettingsPage.confirmRestore('${this.escAttr(b.filename)}')"
                                    class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-yellow-400" title="Restore">
                                    <span class="material-symbols-outlined text-sm">restore</span>
                                </button>
                                <button onclick="SettingsPage.deleteBackup('${this.escAttr(b.filename)}')"
                                    class="p-2 rounded-lg hover:bg-surface-container-high transition-colors text-outline hover:text-red-400" title="Delete">
                                    <span class="material-symbols-outlined text-sm">delete</span>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        } catch (err) {
            container.innerHTML = `<p class="text-red-400 text-sm">${this.esc(err.message)}</p>`;
        }
    },

    async createBackup() {
        const btn = document.getElementById('backup-create-btn');
        const msgEl = document.getElementById('backup-action-msg');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="qi-spinner" style="width:16px;height:16px;border-width:2px"></span> Creating...'; }
        try {
            await API.createBackup();
            this.showMsg(msgEl, 'Backup created successfully.', false);
            this.loadBackupList();
            this.loadBackupSettings();
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> Create Backup Now'; }
        }
    },

    async uploadBackup(e) {
        const file = e.target?.files?.[0];
        if (!file) return;
        e.target.value = '';
        const msgEl = document.getElementById('backup-action-msg');
        try {
            await API.uploadBackup(file);
            this.showMsg(msgEl, `Backup "${this.esc(file.name)}" uploaded successfully.`, false);
            this.loadBackupList();
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    confirmRestore(filename) {
        const msgEl = document.getElementById('backup-action-msg');
        if (msgEl) {
            msgEl.classList.remove('hidden', 'text-primary', 'bg-primary/10', 'text-red-400', 'bg-red-400/10');
            msgEl.classList.add('bg-yellow-400/10', 'text-yellow-400');
            msgEl.innerHTML = `
                <div class="flex items-start gap-3">
                    <span class="material-symbols-outlined text-lg">warning</span>
                    <div class="flex-1">
                        <p class="font-semibold mb-1">Restore this backup?</p>
                        <p class="text-xs opacity-80 mb-3">This will replace ALL current data — database, users, settings, 2FA, and media files. This cannot be undone.</p>
                        <div class="flex gap-3">
                            <button onclick="SettingsPage.restoreBackup('${this.escAttr(filename)}')"
                                class="bg-yellow-400 text-black px-4 py-2 rounded-full font-headline font-bold text-xs hover:scale-[1.02] transition-transform">
                                Yes, Restore
                            </button>
                            <button onclick="document.getElementById('backup-action-msg').classList.add('hidden')"
                                class="px-4 py-2 rounded-full font-headline font-bold text-xs border border-outline-variant/20 text-outline hover:bg-surface-container-high transition-colors">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>`;
        }
    },

    async restoreBackup(filename) {
        const msgEl = document.getElementById('backup-action-msg');
        try {
            this.showMsg(msgEl, 'Restoring backup... Please wait.', false);
            await API.restoreBackup(filename);
            msgEl.classList.remove('hidden', 'text-red-400', 'bg-red-400/10', 'bg-yellow-400/10', 'text-yellow-400');
            msgEl.classList.add('text-primary', 'bg-primary/10');
            msgEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined filled">check_circle</span>
                    <span>Backup restored successfully. The page will reload now.</span>
                </div>`;
            setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    async deleteBackup(filename) {
        if (!confirm('Delete this backup? This cannot be undone.')) return;
        const msgEl = document.getElementById('backup-action-msg');
        try {
            await API.deleteBackup(filename);
            this.loadBackupList();
        } catch (err) {
            this.showMsg(msgEl, err.message, true);
        }
    },

    _formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
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
