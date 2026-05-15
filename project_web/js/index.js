/**
 * index.js — Everything that powers the **home page** (index.html) in the browser.
 *
 * What this file does (high level for the team):
 * 1) **Public recent tables** — Fills the “Lost Items” and “Found Items” tables by calling the
 *    safe public API (see app.js: GET /api/public/items/recent/lost and .../found). Those routes
 *    never require login and only return up to 3 rows each, so the home page can stay public.
 * 2) **Login modal** — The site used to block the whole page with a login wall; now the overlay
 *    opens only when the user clicks “Login”. Submitting the form POSTs to /api/auth/login with
 *    credentials: "include" so the session cookie is stored.
 * 3) **Nav visibility** — Guests only see Home + Login in the header (and matching floating buttons).
 *    After a successful session check or login, we show Catalog + Account because those pages
 *    expect an admin session (same idea as catalog.js redirecting on 401).
 * 4) **Single session button** — One link toggles label + behaviour: Login → opens modal;
 *    Logout → POST /api/auth/logout then refresh UI.
 *
 * Load order: initIndexPage() runs at the bottom. It waits for BOTH session refresh and table
 * fetch in parallel so the first paint is consistent when possible.
 */

// --- DOM references (must match ids in index.html) ---
const overlayEl = document.getElementById("loginOverlay");
const loginCardEl = document.getElementById("loginCard");
const formEl = document.getElementById("adminLoginForm");
const errorEl = document.getElementById("loginError");
const sessionNavBtn = document.getElementById("sessionNavBtn");
const closeLoginBtn = document.getElementById("closeLoginBtn");
// Catalog / Account <li> rows: default markup uses `hidden` so guests don’t see admin-only links.
const navCatalogItem = document.getElementById("navCatalogItem");
const navAccountItem = document.getElementById("navAccountItem");
// Bottom-right floating shortcuts — kept in sync with the header for logged-in users.
const navQuickCatalog = document.getElementById("navQuickCatalog");
const navQuickAccount = document.getElementById("navQuickAccount");
// Table bodies filled by loadPublicRecentTables(); empty until fetch completes.
const lostItemsBody = document.getElementById("lostItemsBody");
const foundItemsBody = document.getElementById("foundItemsBody");

/** Mirrors the server session after /api/auth/session or a successful login. */
let isAuthenticated = false;

// --- Small helpers for rendering table rows safely ---

function formatDate(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleDateString();
}

/** Prevents reflected XSS if an item name ever contained HTML special characters. */
function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Optional hook: if the URL is index.html?search=wallet, both public endpoints receive the same
 * search query. Handy for demos or future UI without changing the server contract.
 */
function publicSearchQueryString() {
    const raw = new URLSearchParams(window.location.search).get("search");
    const term = raw != null ? String(raw).trim() : "";
    if (!term) return "";
    return `?search=${encodeURIComponent(term)}`;
}

/** Builds innerHTML for tbody#lostItemsBody (columns: name, date reported, campus). */
function renderLostRows(items) {
    if (!items.length) {
        return '<tr><td colspan="3">No items to show.</td></tr>';
    }
    return items
        .map(
            (item) => `
        <tr>
            <td>${escapeHtml(item.item_name ?? "-")}</td>
            <td>${escapeHtml(formatDate(item.date_reported))}</td>
            <td>${escapeHtml(item.campus ?? "-")}</td>
        </tr>`,
        )
        .join("");
}

/** Builds innerHTML for tbody#foundItemsBody; prefers date_found, falls back to date_reported. */
function renderFoundRows(items) {
    if (!items.length) {
        return '<tr><td colspan="3">No items to show.</td></tr>';
    }
    return items
        .map((item) => {
            const when = item.date_found || item.date_reported;
            return `
        <tr>
            <td>${escapeHtml(item.item_name ?? "-")}</td>
            <td>${escapeHtml(formatDate(when))}</td>
            <td>${escapeHtml(item.campus ?? "-")}</td>
        </tr>`;
        })
        .join("");
}

/**
 * Pulls the home-page preview from the **public** API (no cookies sent on purpose).
 * We use credentials: "omit" so this feature never accidentally depends on being logged in.
 */
async function loadPublicRecentTables() {
    if (!lostItemsBody && !foundItemsBody) {
        return;
    }
    const qs = publicSearchQueryString();
    const opts = { credentials: "omit" };
    try {
        const [lostRes, foundRes] = await Promise.all([
            lostItemsBody
                ? fetch(`/api/public/items/recent/lost${qs}`, opts)
                : Promise.resolve(null),
            foundItemsBody
                ? fetch(`/api/public/items/recent/found${qs}`, opts)
                : Promise.resolve(null),
        ]);

        if (lostItemsBody) {
            if (!lostRes.ok) {
                throw new Error("lost");
            }
            const lostData = await lostRes.json();
            lostItemsBody.innerHTML = renderLostRows(lostData.items || []);
        }
        if (foundItemsBody) {
            if (!foundRes.ok) {
                throw new Error("found");
            }
            const foundData = await foundRes.json();
            foundItemsBody.innerHTML = renderFoundRows(foundData.items || []);
        }
    } catch (_error) {
        const errRow = '<tr><td colspan="3">Unable to load items.</td></tr>';
        if (lostItemsBody) {
            lostItemsBody.innerHTML = errRow;
        }
        if (foundItemsBody) {
            foundItemsBody.innerHTML = errRow;
        }
    }
}

/** Updates the one nav control between “Login” and “Logout” icons/text. */
function renderSessionButton() {
    if (!sessionNavBtn) {
        return;
    }
    if (isAuthenticated) {
        sessionNavBtn.innerHTML = '<i class="bi bi-box-arrow-right"></i> Logout';
    } else {
        sessionNavBtn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Login';
    }
}

/**
 * Central place to flip the UI after /api/auth/session, login success, or logout.
 * Hides Catalog/Account (and quick nav) until someone is authenticated — keeps public UX simple.
 */
function setAuthenticated(value) {
    isAuthenticated = Boolean(value);
    renderSessionButton();
    const showAdminNav = isAuthenticated;
    if (navCatalogItem) {
        navCatalogItem.hidden = !showAdminNav;
    }
    if (navAccountItem) {
        navAccountItem.hidden = !showAdminNav;
    }
    if (navQuickCatalog) {
        navQuickCatalog.hidden = !showAdminNav;
    }
    if (navQuickAccount) {
        navQuickAccount.hidden = !showAdminNav;
    }
}

/** Shows the full-screen overlay; login.css uses .login-overlay.is-open { display: flex }. */
function openLoginOverlay() {
    if (!overlayEl) {
        return;
    }
    overlayEl.classList.add("is-open");
    overlayEl.setAttribute("aria-hidden", "false");
    if (errorEl) {
        errorEl.textContent = "";
    }
    const usernameInput = document.getElementById("username");
    if (usernameInput) {
        requestAnimationFrame(() => usernameInput.focus());
    }
}

function closeLoginOverlay() {
    if (!overlayEl) {
        return;
    }
    overlayEl.classList.remove("is-open");
    overlayEl.setAttribute("aria-hidden", "true");
    if (errorEl) {
        errorEl.textContent = "";
    }
}

/** Ask the server whether the session cookie is still a valid admin login. */
async function refreshSession() {
    try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        const data = await response.json();
        setAuthenticated(Boolean(data.authenticated));
    } catch (_error) {
        setAuthenticated(false);
    }
}

/**
 * All click/submit listeners for login + overlay behaviour.
 * Split out so initIndexPage can await data first, then attach handlers once.
 */
function wireLoginAndNav() {
    if (!sessionNavBtn || !formEl) {
        return;
    }

    sessionNavBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        if (isAuthenticated) {
            try {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include",
                });
            } catch (_error) {
                // Clear UI even if the request fails.
            }
            closeLoginOverlay();
            formEl.reset();
            setAuthenticated(false);
            return;
        }
        openLoginOverlay();
    });

    if (closeLoginBtn) {
        closeLoginBtn.addEventListener("click", () => {
            closeLoginOverlay();
            formEl.reset();
        });
    }

    if (overlayEl) {
        overlayEl.addEventListener("click", (event) => {
            if (event.target === overlayEl) {
                closeLoginOverlay();
                formEl.reset();
            }
        });
    }

    if (loginCardEl) {
        loginCardEl.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && overlayEl && overlayEl.classList.contains("is-open")) {
            closeLoginOverlay();
            formEl.reset();
        }
    });

    formEl.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (errorEl) {
            errorEl.textContent = "";
        }

        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();
            if (!response.ok) {
                if (errorEl) {
                    errorEl.textContent = data.error || "Login failed";
                }
                return;
            }

            closeLoginOverlay();
            formEl.reset();
            setAuthenticated(true);
        } catch (_error) {
            if (errorEl) {
                errorEl.textContent = "Unable to reach server";
            }
        }
    });
}

/** Entry point: session + public tables in parallel, then wire login UI. */
async function initIndexPage() {
    await Promise.all([refreshSession(), loadPublicRecentTables()]);
    closeLoginOverlay();
    wireLoginAndNav();
}

void initIndexPage();
