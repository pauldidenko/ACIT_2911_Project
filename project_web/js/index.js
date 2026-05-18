/**
 * index.js - Home page (index.html): public “recent items” tables only.
 *
 * Login modal, session check, and Logout / nav visibility live in **login.js** (`AppAuth.initHomePageAuth`).
 * Load order in index.html: `login.js` then this file (both defer) so `AppAuth` exists before `initIndexPage` runs.
 */

const lostItemsBody = document.getElementById("lostItemsBody");
const foundItemsBody = document.getElementById("foundItemsBody");

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

/** Session + login UI (login.js) runs beside public tables so first paint stays consistent when possible. */
async function initIndexPage() {
    // If login.js failed to load, we still show public tables - just skip auth wiring instead of throwing.
    const auth =
        typeof AppAuth !== "undefined" ? AppAuth.initHomePageAuth() : Promise.resolve();
    await Promise.all([auth, loadPublicRecentTables()]);
}

void initIndexPage();
