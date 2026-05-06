/**
 * catalog.js — Lost & Found items catalog page logic.
 *
 * This file runs after catalog.html has loaded (script tag is at the bottom of the page),
 * so getElementById can safely find every element.
 *
 * Flow:
 * 1. User must be logged in (session cookie). If not, the API returns 401 and we send them to login (index.html).
 * 2. loadItems() asks the server for one page of items, using current filters + sort + page number.
 * 3. renderRows() fills the HTML table with the JSON rows returned.
 *
 * API: GET `/api/admin/items` with query params (see app.js `listAdminItems`). Same origin as catalog page when using `npm start`.
 */

// How many rows per page (must match what you expect in the UI).
const PAGE_SIZE = 10;

// Which page we are on right now (1-based). Used in the API query ?page=...
let currentPage = 1;

// Total pages from the last successful response (used to disable Next / know bounds).
let currentTotalPages = 1;

// --- Grab references to every interactive piece of the page (must match id="" in catalog.html) ---
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const statusFilter = document.getElementById("statusFilter");
const campusFilter = document.getElementById("campusFilter");
const dateFromFilter = document.getElementById("dateFromFilter");
const sortBy = document.getElementById("sortBy");
const sortDir = document.getElementById("sortDir");
const catalogBody = document.getElementById("catalogBody");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");
const logoutBtn = document.getElementById("logoutBtn");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");

/** Turn a date string from the server into a short local date for display (e.g. US locale). */
function formatDate(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleDateString();
}

/** Capitalize first letter so status looks nicer in the table (lost → Lost). */
function toTitleCase(value) {
    if (!value) return "-";
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Builds the table body HTML from the array of item objects returned by the API.
 * Uses template literals (`backticks`) to inject values — same idea as Python f-strings.
 */
function renderRows(items) {
    if (!items.length) {
        catalogBody.innerHTML = '<tr><td colspan="6">No items found.</td></tr>';
        return;
    }

    catalogBody.innerHTML = items.map((item) => `
                <tr>
                    <td>${item.item_name ?? "-"}</td>
                    <td>${item.category ?? "-"}</td>
                    <td>${formatDate(item.date_reported)}</td>
                    <td>${item.campus ?? "-"}</td>
                    <td><span class="status ${item.status}">${toTitleCase(item.status)}</span></td>
                    <td>
                        <a href="#" class="action-btn view-btn">View</a>
                        <a href="#" class="action-btn edit-btn">Edit</a>
                    </td>
                </tr>
            `).join("");
}

/** Updates the “Page X of Y” text and enables/disables Prev/Next buttons. */
function updatePagination(page, totalPages) {
    currentPage = page;
    currentTotalPages = totalPages;
    pageInfo.textContent = `Page ${page} of ${totalPages}`;
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages;
}

/**
 * Main data fetch: calls GET /api/admin/items with query params built from the form.
 * credentials: "include" sends the browser cookie so the server knows who is logged in.
 */
async function loadItems() {
    const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(PAGE_SIZE),
        search: searchInput.value.trim(),
        category: categoryFilter.value,
        status: statusFilter.value,
        campus: campusFilter.value,
        dateFrom: dateFromFilter.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value
    });

    const response = await fetch(`/api/admin/items?${params.toString()}`, {
        credentials: "include"
    });

    // Not logged in → go back to home/login page.
    if (response.status === 401) {
        window.location.href = "/index.html";
        return;
    }

    const data = await response.json();
    if (!response.ok) {
        catalogBody.innerHTML = `<tr><td colspan="6">${data.error || "Failed to load items."}</td></tr>`;
        return;
    }

    renderRows(data.items || []);
    updatePagination(data.pagination.page, data.pagination.totalPages);
}

/** Whenever filters change, start again from page 1 so you don’t land on an empty page. */
function onFilterChange() {
    currentPage = 1;
    loadItems();
}

// Debounce: wait until user stops typing for 250ms before searching (fewer API calls).
let searchDebounce;
searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(onFilterChange, 250);
});

// Any dropdown or date change triggers a fresh load from page 1.
[categoryFilter, statusFilter, campusFilter, dateFromFilter, sortBy, sortDir].forEach((el) => {
    el.addEventListener("change", onFilterChange);
});

prevPageBtn.addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    loadItems();
});

nextPageBtn.addEventListener("click", () => {
    if (currentPage >= currentTotalPages) return;
    currentPage += 1;
    loadItems();
});

// Reset all filters and sort to defaults, then reload (same as freshly opening catalog with defaults).
resetFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.selectedIndex = 0;
    statusFilter.selectedIndex = 0;
    campusFilter.selectedIndex = 0;
    dateFromFilter.value = "";
    sortBy.selectedIndex = 0;
    sortDir.selectedIndex = 0;
    currentPage = 1;
    loadItems();
});

// Tell server to destroy session cookie, then leave catalog for login/home.
logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (_error) {
        // ignore
    }
    window.location.href = "/index.html";
});

// First paint: load page 1 as soon as script runs.
loadItems();
