/*
 * login.js - session helpers for all pages (logout, who is logged in).
 * Home page also gets the login popup and MFA step.
 * Exposes window.AppAuth so other scripts can call the same helpers.
 */
(function attachAppAuth(global) {
    const DEFAULT_HOME = "/index.html";

    /* POST logout - still redirect even if the request fails */
    async function postLogout() {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "include",
            });
        } catch (_err) {
            /* user is leaving anyway */
        }
    }

    /* GET session - returns { authenticated, username } or logged out on error */
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

    /* Wire any link to POST logout then go home */
    function wireLogoutButton(element, redirectUrl = DEFAULT_HOME) {
        if (!element) return;
        element.addEventListener("click", async (event) => {
            event.preventDefault();
            await postLogout();
            global.location.href = redirectUrl;
        });
    }

    /* Same as wireLogoutButton but looks up #logoutBtn */
    function wireStandardLogoutById(
        buttonId = "logoutBtn",
        redirectUrl = DEFAULT_HOME,
    ) {
        wireLogoutButton(document.getElementById(buttonId), redirectUrl);
    }

    /*
     * add-item page: API might be on another port (Live Server).
     * Pass async functions that return the real logout and redirect URLs.
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
                /* fallback if apiUrl fails */
                global.location.href = DEFAULT_HOME;
            }
        });
    }

    /* --- Home page only: login popup --- */

    /* Avoid double-binding listeners */
    let homeLoginWired = false;

    let isAuthenticated = false;

    /* Lazy lookups - overlay only exists on index.html */
    const overlayEl = () => document.getElementById("loginOverlay");
    const loginCardEl = () => document.getElementById("loginCard");
    const formEl = () => document.getElementById("adminLoginForm");
    const errorEl = () => document.getElementById("loginError");
    const loginStepCredentials = () => document.getElementById("loginStepCredentials");
    const loginStepMfa = () => document.getElementById("loginStepMfa");
    const totpCodeEl = () => document.getElementById("totpCode");
    const loginSubmitBtn = () => document.getElementById("loginSubmitBtn");
    const loginCardTitle = () => document.querySelector("#loginCard h2");
    const sessionNavBtn = () => document.getElementById("sessionNavBtn");
    const closeLoginBtn = () => document.getElementById("closeLoginBtn");
    const navCatalogItem = () => document.getElementById("navCatalogItem");
    const navAccountItem = () => document.getElementById("navAccountItem");
    const navQuickCatalog = () => document.getElementById("navQuickCatalog");
    const navQuickAccount = () => document.getElementById("navQuickAccount");

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

    /* Show or hide Catalog / Account links for guests vs logged-in staff */
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

    function closeLoginOverlay() {
        const overlay = overlayEl();
        if (!overlay) return;
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        const err = errorEl();
        if (err) err.textContent = "";
        showLoginCredentialsStep();
    }

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

    /* Server wants MFA - show 6-digit field, second submit sends totpCode */
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

    async function refreshHomeSession() {
        const data = await fetchSession();
        setAuthenticated(Boolean(data.authenticated));
    }

    /* Login button, cancel, backdrop click, Escape, form submit (password then maybe MFA) */
    function wireHomeLoginAndNav() {
        const form = formEl();
        const navBtn = sessionNavBtn();
        if (!navBtn || !form || homeLoginWired) return;
        homeLoginWired = true;

        /* One nav link: Login opens modal, Logout signs out */
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
            closeBtn.addEventListener("click", () => {
                closeLoginOverlay();
                form.reset();
            });
        }

        const overlay = overlayEl();
        if (overlay) {
            /* Click outside the card = cancel */
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay) {
                    closeLoginOverlay();
                    form.reset();
                }
            });
        }

        const card = loginCardEl();
        if (card) {
            /* Don't close when clicking inside the card */
            card.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }

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

        /* Submit: password first; if MFA step is open, include totpCode */
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
                /* Password OK but need authenticator code */
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

    /* Called from index.js on page load */
    async function initHomePageAuth() {
        await refreshHomeSession();
        closeLoginOverlay();
        wireHomeLoginAndNav();
    }

    global.AppAuth = {
        postLogout,
        fetchSession,
        wireLogoutButton,
        wireStandardLogoutById,
        wireLogoutWithAsyncUrls,
        initHomePageAuth,
        refreshHomeSession,
    };
})(typeof window !== "undefined" ? window : globalThis);
