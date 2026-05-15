/**
 * account.js — Guard + behaviour for **account.html** (admin profile / quick links page).
 *
 * Why this file exists:
 * - The account page is not meant for random visitors. Unlike index.html (public), anyone who
 *   bookmarks /account.html should be bounced home unless they already have a valid session cookie.
 * - We mirror the **catalog** idea: catalog.js calls an admin API and redirects on 401; here we
 *   proactively call GET /api/auth/session (lightweight, no DB list) and redirect if `authenticated`
 *   is false. That way we don’t flash sensitive layout longer than necessary.
 *
 * Flow:
 *   1) Fetch session with credentials: "include" (browser sends the same cookie as catalog).
 *   2) If not authenticated → window.location to index.html (stops the rest of the script).
 *   3) If authenticated → show who is logged in (#accountUsername) and wire Logout.
 *   4) loadAccountStats() → GET /api/admin/stats with the same session cookie. Populates the four
 *      stat paragraphs in account.html (#statTotalItems, …). If the stats call returns 401 (session
 *      expired or tampered), redirect to index.html like an unauthenticated visitor.
 *
 * Related files: app.js (/api/auth/session, /api/auth/logout, /api/admin/stats), account.html.
 */

/**
 * Fetches aggregate item counts for the Account page stat cards.
 *
 * API: GET /api/admin/stats (admin-only). Response fields: totalItems, totalLost, totalFound,
 * totalClaimed — see app.js route handler for how each count is defined in SQL.
 *
 * DOM: each tuple is [element id, JSON property name]. Placeholder "—" means loading failed or
 * response was not OK; numeric fields render as decimal strings (missing values become "0").
 */
async function loadAccountStats() {
    const ids = [
        ["statTotalItems", "totalItems"],
        ["statTotalLost", "totalLost"],
        ["statTotalFound", "totalFound"],
        ["statTotalClaimed", "totalClaimed"],
    ];
    let response;
    try {
        response = await fetch("/api/admin/stats", { credentials: "include" });
    } catch (_error) {
        // Network failure: keep em dashes so the page does not show stale hard-coded numbers.
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "—";
        }
        return;
    }
    if (response.status === 401) {
        // Cookie invalid or not admin — treat like logged out (same destination as session check).
        window.location.href = "/index.html";
        return;
    }
    if (!response.ok) {
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "—";
        }
        return;
    }
    let data;
    try {
        data = await response.json();
    } catch (_error) {
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "—";
        }
        return;
    }
    for (const [elId, key] of ids) {
        const el = document.getElementById(elId);
        if (el) {
            const n = data[key];
            el.textContent = typeof n === "number" && Number.isFinite(n) ? String(n) : "0";
        }
    }
}

async function initAccountPage() {
    let data;
    try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        data = await response.json();
    } catch (_error) {
        // Network down or server error — safest UX is to treat as logged-out and send them home.
        window.location.href = "/index.html";
        return;
    }

    if (!data.authenticated) {
        window.location.href = "/index.html";
        return;
    }

    // Replace the placeholder “admin” text with whoever actually logged in (from session JSON).
    const usernameEl = document.getElementById("accountUsername");
    if (usernameEl && data.username) {
        usernameEl.textContent = data.username;
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            try {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include",
                });
            } catch (_error) {
                // Still leave for home — user intent is clearly “sign out”.
            }
            window.location.href = "/index.html";
        });
    }

    // Stats require an admin session; server enforces it. Runs after username + logout wiring.
    await loadAccountStats();
}

void initAccountPage();
