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
 *
 * Related files: app.js (/api/auth/session, /api/auth/logout), account.html (markup + script tag).
 */

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
}

void initAccountPage();
