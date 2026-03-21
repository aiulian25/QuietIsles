// Login / Setup page
const LoginPage = {
    async render() {
        const container = document.getElementById('page-content');

        // Hide nav elements on login
        document.getElementById('sidebar')?.classList.add('!hidden');
        document.getElementById('mobile-nav')?.classList.add('!hidden');
        document.getElementById('topbar')?.classList.add('!hidden');

        try {
            const status = await API.getSetupStatus();
            if (status.needs_setup) {
                container.innerHTML = this.renderSetup();
            } else {
                container.innerHTML = this.renderLogin();
            }
        } catch {
            container.innerHTML = this.renderLogin();
        }
    },

    destroy() {
        document.getElementById('sidebar')?.classList.remove('!hidden');
        document.getElementById('mobile-nav')?.classList.remove('!hidden');
        document.getElementById('topbar')?.classList.remove('!hidden');
    },

    renderLogin() {
        return `
        <div class="min-h-screen flex items-center justify-center px-6">
            <div class="w-full max-w-md">
                <div class="text-center mb-10">
                    <img src="/assets/logo.png" alt="Quiet Isles" class="w-16 h-16 rounded-2xl mx-auto mb-4"/>
                    <h1 class="font-headline text-3xl font-bold text-on-surface tracking-tight">Welcome Back</h1>
                    <p class="text-on-surface-variant text-sm mt-2">Sign in to Quiet Isles</p>
                </div>
                <form id="login-form" class="space-y-5" onsubmit="LoginPage.handleLogin(event)">
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Username</label>
                        <input name="username" type="text" required autocomplete="username"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                    </div>
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Password</label>
                        <input name="password" type="password" required autocomplete="current-password"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                    </div>
                    <div id="totp-field" class="hidden">
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">2FA Code</label>
                        <input name="totp_code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all font-mono text-center text-lg tracking-widest"/>
                        <button type="button" onclick="LoginPage.toggleBackupCode()" class="text-xs text-primary mt-2 hover:underline">Use backup code instead</button>
                    </div>
                    <div id="backup-field" class="hidden">
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Backup Code</label>
                        <input name="backup_code" type="text" maxlength="8"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all font-mono text-center text-lg tracking-widest uppercase"/>
                        <button type="button" onclick="LoginPage.toggleBackupCode()" class="text-xs text-primary mt-2 hover:underline">Use authenticator instead</button>
                    </div>
                    <div id="login-error" class="hidden text-sm text-red-400 bg-red-400/10 rounded-xl px-4 py-3"></div>
                    <button type="submit" id="login-btn"
                        class="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-4 rounded-full font-headline font-bold text-sm tracking-widest uppercase hover:scale-[1.02] transition-transform">
                        Sign In
                    </button>
                </form>
            </div>
        </div>`;
    },

    renderSetup() {
        return `
        <div class="min-h-screen flex items-center justify-center px-6">
            <div class="w-full max-w-md">
                <div class="text-center mb-10">
                    <img src="/assets/logo.png" alt="Quiet Isles" class="w-16 h-16 rounded-2xl mx-auto mb-4"/>
                    <h1 class="font-headline text-3xl font-bold text-on-surface tracking-tight">Create Admin Account</h1>
                    <p class="text-on-surface-variant text-sm mt-2">Set up your Quiet Isles instance</p>
                </div>
                <form id="setup-form" class="space-y-5" onsubmit="LoginPage.handleSetup(event)">
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Display Name</label>
                        <input name="display_name" type="text"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            placeholder="Optional"/>
                    </div>
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Username</label>
                        <input name="username" type="text" required autocomplete="username"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                    </div>
                    <div>
                        <label class="block text-xs font-headline text-outline uppercase tracking-widest mb-2">Password</label>
                        <input name="password" type="password" required minlength="8" autocomplete="new-password"
                            class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"/>
                        <p class="text-xs text-outline mt-1">Minimum 8 characters</p>
                    </div>
                    <div id="setup-error" class="hidden text-sm text-red-400 bg-red-400/10 rounded-xl px-4 py-3"></div>
                    <button type="submit" id="setup-btn"
                        class="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-4 rounded-full font-headline font-bold text-sm tracking-widest uppercase hover:scale-[1.02] transition-transform">
                        Create Account
                    </button>
                </form>
            </div>
        </div>`;
    },

    toggleBackupCode() {
        const totp = document.getElementById('totp-field');
        const backup = document.getElementById('backup-field');
        if (totp && backup) {
            totp.classList.toggle('hidden');
            backup.classList.toggle('hidden');
        }
    },

    async handleLogin(e) {
        e.preventDefault();
        const form = e.target;
        const errEl = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');

        const data = {
            username: form.username.value.trim(),
            password: form.password.value,
            totp_code: form.totp_code?.value?.trim() || '',
            backup_code: form.backup_code?.value?.trim() || '',
        };

        try {
            btn.disabled = true;
            btn.textContent = 'Signing in...';
            errEl?.classList.add('hidden');

            const resp = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(data),
            });
            const result = await resp.json();

            if (result.requires_2fa) {
                document.getElementById('totp-field')?.classList.remove('hidden');
                btn.disabled = false;
                btn.textContent = 'Sign In';
                form.totp_code?.focus();
                return;
            }

            if (!resp.ok) {
                throw new Error(result.error || 'Login failed');
            }

            Auth.user = result.user;
            this.destroy();
            Router.navigate('/');
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message;
                errEl.classList.remove('hidden');
            }
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    },

    async handleSetup(e) {
        e.preventDefault();
        const form = e.target;
        const errEl = document.getElementById('setup-error');
        const btn = document.getElementById('setup-btn');

        const data = {
            username: form.username.value.trim(),
            password: form.password.value,
            display_name: form.display_name.value.trim(),
        };

        try {
            btn.disabled = true;
            btn.textContent = 'Creating...';
            errEl?.classList.add('hidden');

            const result = await API.register(data);
            Auth.user = result.user;
            this.destroy();
            Router.navigate('/');
        } catch (err) {
            if (errEl) {
                errEl.textContent = err.message;
                errEl.classList.remove('hidden');
            }
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
    },
};
