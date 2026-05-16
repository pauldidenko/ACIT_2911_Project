/**
 * login.js — Shared auth helpers for every page that talks to Express sessions.
 *
 * What lives here on purpose:
 * - **POST /api/auth/logout** + redirect — same behaviour for catalog, account, add-item (`#logoutBtn`).
 * - **GET /api/auth/session** — thin wrapper other scripts can reuse if they need JSON without duplicating fetch.
 * - **index.html only** — the login overlay, `#sessionNavBtn` toggle, and showing/hiding Catalog + Account links.
 *
 * Other pages load this file *before* their page script so `window.AppAuth` is ready (see script order in each HTML).
 */
(function attachAppAuth(global) {
    const DEFAULT_HOME = "/index.html";

    /**
     * Clears the server session cookie. Safe to call even if the network fails — callers still redirect if they want.
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
     * Lightweight “who am I?” check. Returns `{ authenticated: boolean, username?: string }` on success,
     * or `{ authenticated: false }` if the request blows up (offline server, etc.).
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
     * Standard navbar logout (`#logoutBtn` on catalog / account / add-item): destroy session then go home.
     */
    function wireLogoutButton(element, redirectUrl = DEFAULT_HOME) {
        if (!element) return;
        element.addEventListener("click", async (event) => {
            event.preventDefault();
            await postLogout();
            global.location.href = redirectUrl;
        });
    }

    function wireStandardLogoutById(
        buttonId = "logoutBtn",
        redirectUrl = DEFAULT_HOME,
    ) {
        wireLogoutButton(document.getElementById(buttonId), redirectUrl);
    }

    /**
     * add-item.html resolves the real Express origin for Live Server; logout + redirect must use the same helper.
     * Pass async functions that return absolute or same-origin URLs.
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
                global.location.href = DEFAULT_HOME;
            }
        });
    }

    // ----- index.html: modal + session nav (elements missing on other pages → everything no-ops safely) -----

    let homeLoginWired = false;
    let isAuthenticated = false;

    const overlayEl = () => document.getElementById("loginOverlay");
    const loginCardEl = () => document.getElementById("loginCard");
    const formEl = () => document.getElementById("adminLoginForm");
    const errorEl = () => document.getElementById("loginError");
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

    /**
     * After session refresh or login/logout: show or hide admin-only nav targets (same rules as before the split).
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

    function openLoginOverlay() {
        const overlay = overlayEl();
        if (!overlay) return;
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
    }

    async function refreshHomeSession() {
        const data = await fetchSession();
        setAuthenticated(Boolean(data.authenticated));
    }

    function wireHomeLoginAndNav() {
        const form = formEl();
        const navBtn = sessionNavBtn();
        if (!navBtn || !form || homeLoginWired) return;
        homeLoginWired = true;

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
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay) {
                    closeLoginOverlay();
                    form.reset();
                }
            });
        }

        const card = loginCardEl();
        if (card) {
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

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const err = errorEl();
            if (err) err.textContent = "";

            const usernameEl = document.getElementById("username");
            const passwordEl = document.getElementById("password");
            const username = usernameEl ? usernameEl.value.trim() : "";
            const password = passwordEl ? passwordEl.value : "";

            try {
                const response = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ username, password }),
                });

                const data = await response.json();
                if (!response.ok) {
                    if (err) err.textContent = data.error || "Login failed";
                    return;
                }

                closeLoginOverlay();
                form.reset();
                setAuthenticated(true);
            } catch (_error) {
                if (err) err.textContent = "Unable to reach server";
            }
        });
    }

    /**
     * Home entry: sync session with server, close any stuck overlay, attach one-time listeners.
     * `index.js` awaits this in parallel with loading the public tables.
     */
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
        /** Used only on index if something else needs to re-pull session later. */
        refreshHomeSession,
    };
})(typeof window !== "undefined" ? window : globalThis);
