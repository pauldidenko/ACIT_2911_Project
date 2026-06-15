/**
 * login.js - Shared auth helpers for every page that talks to Express sessions.
 *
 * What lives here on purpose:
 * - **POST /api/auth/logout** + redirect - same behaviour for catalog, account, add-item (`#logoutBtn`).
 * - **GET /api/auth/session** - thin wrapper other scripts can reuse if they need JSON without duplicating fetch.
 * - **index.html only** - the login overlay, `#sessionNavBtn` toggle, and showing/hiding Catalog + Account links.
 *
 * **MFA on home login (index.html only):**
 * - First submit sends username + password. If the account has MFA, the server replies `{ requires2FA: true }`.
 * - We expand `#loginStepMfa` (6-digit field) under the password; user submits again with `totpCode` in the body.
 * - If MFA is not enabled for that user, the code block stays hidden and login completes in one step.
 *
 * Other pages load this file *before* their page script so `window.AppAuth` is ready (see script order in each HTML).
 *
 * Why an IIFE: we only need one `AppAuth` bag on `window`; wrapping avoids leaking temp names into the global scope.
 */
(function attachAppAuth(global) {
    /** After logout we usually send people to the public home (relative URL works on any host/port). */
    const DEFAULT_HOME = "/index.html";

    /**
     * Tells Express to clear the admin session cookie. We never throw - if the tab is offline or the
     * server hiccups, the UI still moves on (e.g. redirect) so the user isn’t stuck staring at a spinner.
     */
    async function postLogout() {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
            });
        } catch (_err) {
            /* user is leaving anyway; don’t block UI on network */
        }
    }

    /**
     * Lightweight “who am I?” for the browser cookie. Same contract as the old inline `refreshSession` on home:
     * returns whatever JSON the server sends (typically `authenticated` + optional `username`).
     * If the network dies or the response isn’t JSON, we pretend you’re logged out - safest default for guards.
     */
    async function fetchSession() {
        try {
            const response = await fetch("/api/auth/session", {
                credentials: "include",
            });
            return await response.json();
        } catch (_err) {
            return { authenticated: false };
        }
    }

    /**
     * Generic “log out from this link” helper: any element (usually `<a href="#">`) gets one click handler.
     * Catalog / account use the same pattern: POST first, then hard navigation so the next page sees a clean guest state.
     */
    function wireLogoutButton(element, redirectUrl = DEFAULT_HOME) {
        if (!element) return;
        element.addEventListener("click", async (event) => {
            event.preventDefault();
            await postLogout();
            global.location.href = redirectUrl;
        });
    }

    /**
     * Convenience for pages that use the shared navbar id `#logoutBtn` (catalog, account, …).
     * Same redirect as `wireLogoutButton`; only difference is we look the element up by id for you.
     */
    function wireStandardLogoutById(
        buttonId = "logoutBtn",
        redirectUrl = DEFAULT_HOME,
    ) {
        wireLogoutButton(document.getElementById(buttonId), redirectUrl);
    }

    /**
     * add-item is special: the HTML might be served from Live Server while the API lives on another origin.
     * Those pages already have an async `apiUrl()` - we reuse it so logout hits the *same* Express instance as the form.
     *
     * `getLogoutUrl` / `getRedirectUrl` can return a relative path (same tab as Express) or a full `http://…` URL.
     * Full URLs need explicit `cors` mode with credentials so the browser doesn’t block the sign-out request.
     */
    function wireLogoutWithAsyncUrls(getLogoutUrl, getRedirectUrl, buttonId = "logoutBtn") {
        const element = document.getElementById(buttonId);
        if (!element || typeof getLogoutUrl !== "function" || typeof getRedirectUrl !== "function") {
            return;
        }
        element.addEventListener("click", async (event) => {
            event.preventDefault();
            try {
                const logoutUrl = await getLogoutUrl();
                await fetch(logoutUrl, {
                    method: "POST",
                    credentials: "include",
                    mode: logoutUrl.startsWith("http") ? "cors" : "same-origin",
                });
            } catch (_err) {
                /* still send user home */
            }
            try {
                global.location.href = await getRedirectUrl();
            } catch (_err2) {
                // If `apiUrl` blew up, still send the user somewhere sensible instead of leaving them on a half-broken page.
                global.location.href = DEFAULT_HOME;
            }
        });
    }

    // ----- index.html only: modal + single “Login / Logout” nav item -----
    // None of these ids exist on catalog/account - every helper below checks for null and bails quietly.

    /** Stops us from attaching duplicate listeners if `initHomePageAuth` were ever called twice (defensive). */
    let homeLoginWired = false;

    /** In-memory mirror of the cookie session for the home header (drives button label + which click path runs). */
    let isAuthenticated = false;

    // Lazy `getElementById` calls: this file loads on every page, but only index has the overlay - no stale null refs at parse time.
    const overlayEl = () => document.getElementById("loginOverlay");
    const loginCardEl = () => document.getElementById("loginCard");
    const formEl = () => document.getElementById("adminLoginForm");
    const errorEl = () => document.getElementById("loginError");
    const loginStepCredentials = () => document.getElementById("loginStepCredentials");
    const loginStepMfa = () => document.getElementById("loginStepMfa"); // hidden until server says requires2FA
    const totpCodeEl = () => document.getElementById("totpCode");
    const loginSubmitBtn = () => document.getElementById("loginSubmitBtn");
    const loginCardTitle = () => document.querySelector("#loginCard h2");
    const sessionNavBtn = () => document.getElementById("sessionNavBtn");
    const closeLoginBtn = () => document.getElementById("closeLoginBtn");
    const navCatalogItem = () => document.getElementById("navCatalogItem");
    const navAccountItem = () => document.getElementById("navAccountItem");
    const navQuickCatalog = () => document.getElementById("navQuickCatalog");
    const navQuickAccount = () => document.getElementById("navQuickAccount");

    /** Swaps the icon + word on `#sessionNavBtn` so one physical link reads “Login” or “Logout” depending on state. */
    function renderSessionButton() {
        const btn = sessionNavBtn();
        if (!btn) return;
        if (isAuthenticated) {
            btn.innerHTML =
                '<i class="bi bi-box-arrow-right"></i> Logout';
        } else {
            btn.innerHTML =
                '<i class="bi bi-box-arrow-in-right"></i> Login';
        }
    }

    /**
     * Single switch for “guest vs admin” chrome on the home page: header Catalog/Account rows + matching FAB links.
     * Guests should never see admin URLs they can’t use; logged-in staff get the same links in two places (nav + float).
     */
    function setAuthenticated(value) {
        isAuthenticated = Boolean(value);
        renderSessionButton();
        const showAdminNav = isAuthenticated;
        const cat = navCatalogItem();
        const acc = navAccountItem();
        const qCat = navQuickCatalog();
        const qAcc = navQuickAccount();
        if (cat) cat.hidden = !showAdminNav;
        if (acc) acc.hidden = !showAdminNav;
        if (qCat) qCat.hidden = !showAdminNav;
        if (qAcc) qAcc.hidden = !showAdminNav;
    }

    /** Opens the dimmed full-screen layer; login.css keys off `.is-open`. Clears any previous error text. */
    function openLoginOverlay() {
        const overlay = overlayEl();
        if (!overlay) return;
        showLoginCredentialsStep();
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        const err = errorEl();
        if (err) err.textContent = "";
        const usernameInput = document.getElementById("username");
        if (usernameInput) {
            requestAnimationFrame(() => usernameInput.focus());
        }
    }

    /** Hides overlay and clears the red inline error strip (used after success, cancel, or backdrop click). */
    function closeLoginOverlay() {
        const overlay = overlayEl();
        if (!overlay) return;
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        const err = errorEl();
        if (err) err.textContent = "";
        showLoginCredentialsStep();
    }

    /** Default login view: username/password only; hide the authenticator code block. */
    function showLoginCredentialsStep() {
        const mfa = loginStepMfa();
        const totp = totpCodeEl();
        const title = loginCardTitle();
        const submit = loginSubmitBtn();
        const card = loginCardEl();
        if (mfa) mfa.hidden = true;
        if (totp) totp.value = "";
        if (title) title.textContent = "Login";
        if (submit) submit.innerHTML = '<i class="bi bi-box-arrow-right"></i>Sign In';
        if (card) card.classList.remove("login-card--mfa");
    }

    /**
     * Password was accepted but this account has MFA - show the code field below (credentials stay visible).
     * User clicks Verify code (or we could add Enter) to POST again with totpCode.
     */
    function showLoginMfaStep() {
        const mfa = loginStepMfa();
        const totp = totpCodeEl();
        const title = loginCardTitle();
        const submit = loginSubmitBtn();
        const card = loginCardEl();
        if (mfa) mfa.hidden = false;
        if (title) title.textContent = "Login";
        if (submit) submit.innerHTML = '<i class="bi bi-shield-check"></i>Verify code';
        if (card) card.classList.add("login-card--mfa");
        if (totp) {
            requestAnimationFrame(() => totp.focus());
        }
    }

    /** On first paint (and whenever you call `refreshHomeSession` later): ask the server if the cookie is still valid. */
    async function refreshHomeSession() {
        const data = await fetchSession();
        setAuthenticated(Boolean(data.authenticated));
    }

    /**
     * Wires every home-only interaction once: session button, overlay dismiss paths, and the admin login form.
     * Intentionally not registered on other routes - keeps catalog/account scripts free of dead listeners.
     */
    function wireHomeLoginAndNav() {
        const form = formEl();
        const navBtn = sessionNavBtn();
        if (!navBtn || !form || homeLoginWired) return;
        homeLoginWired = true;

        // One button, two modes: logged in → sign out and stay on the marketing home; logged out → show the modal.
        navBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            if (isAuthenticated) {
                await postLogout();
                closeLoginOverlay();
                form.reset();
                setAuthenticated(false);
                return;
            }
            openLoginOverlay();
        });

        const closeBtn = closeLoginBtn();
        if (closeBtn) {
            // Explicit “Cancel” - same outcome as clicking the dimmed backdrop.
            closeBtn.addEventListener("click", () => {
                closeLoginOverlay();
                form.reset();
            });
        }

        const overlay = overlayEl();
        if (overlay) {
            // Click the dimmed area outside the white card = “same as cancel” for people who miss the button.
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay) {
                    closeLoginOverlay();
                    form.reset();
                }
            });
        }

        const card = loginCardEl();
        if (card) {
            // Otherwise a click on the form bubbles to the overlay handler and instantly closes the modal - annoying.
            card.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }

        // Match desktop expectations: Escape closes the modal without submitting.
        document.addEventListener("keydown", (event) => {
            const ov = overlayEl();
            if (
                event.key === "Escape" &&
                ov &&
                ov.classList.contains("is-open")
            ) {
                closeLoginOverlay();
                form.reset();
            }
        });

        // Login submit - one form, two steps. First try: password only. Second try (if MFA expanded): password + totpCode.
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const err = errorEl();
            if (err) err.textContent = "";

            const usernameEl = document.getElementById("username");
            const passwordEl = document.getElementById("password");
            const username = usernameEl ? usernameEl.value.trim() : "";
            const password = passwordEl ? passwordEl.value : "";
            const mfaStep = loginStepMfa();
            const onMfaStep = mfaStep && !mfaStep.hidden;
            const totpCode = onMfaStep && totpCodeEl() ? totpCodeEl().value.trim() : "";

            // MFA field is visible - require a full 6-digit code before hitting the server again.
            if (onMfaStep && totpCode.length !== 6) {
                if (err) err.textContent = "Enter the 6-digit code from your authenticator app";
                return;
            }

            const body = { username, password };
            if (onMfaStep) body.totpCode = totpCode;

            try {
                const response = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body),
                });

                const data = await response.json();
                // Password OK; account has MFA - expand code input, do not create session yet.
                if (data.requires2FA) {
                    showLoginMfaStep();
                    return;
                }
                if (!response.ok) {
                    if (err) err.textContent = data.error || "Login failed";
                    return;
                }

                closeLoginOverlay();
                form.reset();
                showLoginCredentialsStep();
                setAuthenticated(true);
            } catch (_error) {
                if (err) err.textContent = "Unable to reach server";
            }
        });
    }

    /**
     * What `index.js` calls on load: figure out guest vs admin, make sure we’re not showing a half-open overlay
     * from a previous navigation, then hook up the modal once. Runs in parallel with the public “recent items” fetch.
     */
    async function initHomePageAuth() {
        await refreshHomeSession();
        closeLoginOverlay();
        wireHomeLoginAndNav();
    }

    // Public bag: other scripts only rely on names documented in the file header - keep this list stable for teammates.
    global.AppAuth = {
        postLogout,
        fetchSession,
        wireLogoutButton,
        wireStandardLogoutById,
        wireLogoutWithAsyncUrls,
        initHomePageAuth,
        /** Rare follow-up on home if you add a “refresh session” control later; same as first-load session pull today. */
        refreshHomeSession,
    };
})(typeof window !== "undefined" ? window : globalThis);
