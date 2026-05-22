/* index.js - home page: load recent lost/found tables (login is in login.js) */

const lostItemsBody = document.getElementById("lostItemsBody");
const foundItemsBody = document.getElementById("foundItemsBody");

function formatDate(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleDateString();
}

/* Escape text before putting it in table HTML */
function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

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

/* Load recent lost/found rows from the public API (no login required) */
async function loadPublicRecentTables() {
    if (!lostItemsBody && !foundItemsBody) {
        return;
    }

    // Optional: index.html?search=wallet filters both tables (no search box on the page)
    const search = new URLSearchParams(window.location.search).get("search")?.trim();
    const query = search ? `?search=${encodeURIComponent(search)}` : "";

    const opts = { credentials: "omit" };
    try {
        const [lostRes, foundRes] = await Promise.all([
            lostItemsBody
                ? fetch(`/api/public/items/recent/lost${query}`, opts)
                : Promise.resolve(null),
            foundItemsBody
                ? fetch(`/api/public/items/recent/found${query}`, opts)
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

async function initIndexPage() {
    /* Run login check and table load at the same time */
    const auth =
        typeof AppAuth !== "undefined" ? AppAuth.initHomePageAuth() : Promise.resolve();
    await Promise.all([auth, loadPublicRecentTables()]);
}

void initIndexPage();
