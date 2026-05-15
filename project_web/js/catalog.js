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

// ! =========== NEW by Gai Deng =====================
// One overlay for View (read-only), Edit (add-item-style form), and Delete confirm.
// `modalContent` is the white card: we toggle `.modal-content--edit` on it so Edit can be wider than View.
const modal = document.getElementById("viewModal");
const modalContent = document.getElementById("modalContent");
const modalBody = document.getElementById("modalBody");
const closeModalBtn = document.getElementById("closeModal");

// ! =================== END  ========================
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
 * One line for the View modal: “Date lost” vs “Date found”.
 * In the real data, found items often still have a date_lost filled in, so we can’t
 * always prefer date_lost first — we pick the single date that makes sense, and if
 * both exist we let the row’s status decide (found → show date found, lost → date lost).
 */
function buildItemDateLine(item) {
    const hasLost = Boolean(item.date_lost && String(item.date_lost).trim());
    const hasFound = Boolean(item.date_found && String(item.date_found).trim());

    if (hasFound && !hasLost) {
        return `<p><strong>Date Found:</strong> ${formatDate(item.date_found)}</p>`;
    }
    if (hasLost && !hasFound) {
        return `<p><strong>Date Lost:</strong> ${formatDate(item.date_lost)}</p>`;
    }
    if (hasFound && hasLost) {
        if (item.status === "found") {
            return `<p><strong>Date Found:</strong> ${formatDate(item.date_found)}</p>`;
        }
        if (item.status === "lost") {
            return `<p><strong>Date Lost:</strong> ${formatDate(item.date_lost)}</p>`;
        }
    }
    return "";
}

// ----- Edit modal: helpers (same field names as add-item.html so PUT matches POST) -----

/** Safe text inside HTML (form values, textarea body, img alt/src). */
function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

/** `input type="date"` needs yyyy-mm-dd; SQLite sometimes returns a longer datetime string. */
function dateInputValue(raw) {
    if (!raw) return "";
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

/** Must stay in lockstep with the server CHECK constraint and add-item.html options. */
const EDIT_CATEGORIES = [
    "Electronics",
    "Accessories",
    "Clothing",
    "Keys & ID",
    "School Supplies",
    "Bottles & containers",
    "Sports & Fitness",
    "Documents",
    "Misc",
];

/** Builds the literal ` selected` attribute on `<option>` when that option matches the saved row. */
function optionSelected(value, current) {
    return value === current ? " selected" : "";
}

/**
 * Edit popup: mirrors add-item.html fields so staff get the same layout and styles (add-item.css + .modal-content--edit).
 * Filled from GET /api/admin/items/:id; submit uses multipart PUT to the same id.
 *
 * We build HTML as a string (no JSX), so every user-controlled value goes through `escapeHtml`
 * to avoid breaking out of attributes or injecting tags. Image path is escaped too for the src attribute.
 */
function buildEditFormHtml(item) {
    const dl = dateInputValue(item.date_lost);
    const df = dateInputValue(item.date_found);
    const catOptions =
        '<option value="">Select category</option>' +
        EDIT_CATEGORIES.map(
            (c) =>
                `<option value="${escapeHtml(c)}"${optionSelected(c, item.category)}>${escapeHtml(c)}</option>`,
        ).join("");
    const campusOptions =
        '<option value="">Select campus</option>' +
        ["Burnaby", "Downtown", "Aerospace"]
            .map(
                (c) =>
                    `<option value="${escapeHtml(c)}"${optionSelected(c, item.campus)}>${escapeHtml(c)}</option>`,
            )
            .join("");
    const st = item.status || "";
    const statusOptions = [
        `<option value="">Select status</option>`,
        `<option value="lost"${optionSelected("lost", st)}>Lost</option>`,
        `<option value="found"${optionSelected("found", st)}>Found</option>`,
        `<option value="claimed"${optionSelected("claimed", st)}>Claimed</option>`,
        `<option value="deleted"${optionSelected("deleted", st)}>Deleted</option>`,
    ].join("");

    const imgSection = item.image_path
        ? `<div class="form-group full-width"><label>Current photo</label><img class="catalog-edit-current-img" src="${escapeHtml(item.image_path)}" alt="Current item image" /></div>`
        : "";

    return `
        <div id="catalogEditError" class="catalog-edit-form-error" hidden></div>
        <form id="catalogEditForm" class="add-item-form catalog-edit-form" data-item-id="${item.id}" enctype="multipart/form-data">
            <div class="form-group">
                <label for="edit_item_name">Item name</label>
                <input type="text" id="edit_item_name" name="item_name" required value="${escapeHtml(item.item_name || "")}" placeholder="Example: Black wallet">
            </div>
            <div class="form-group">
                <label for="edit_category">Category</label>
                <select id="edit_category" name="category" required>${catOptions}</select>
            </div>
            <div class="form-group">
                <label for="edit_campus">Campus</label>
                <select id="edit_campus" name="campus" required>${campusOptions}</select>
            </div>
            <div class="form-group">
                <label for="edit_status">Status</label>
                <select id="edit_status" name="status" required>${statusOptions}</select>
            </div>
            <div class="form-group">
                <label for="edit_location_details">Where found / reported <span class="optional">(optional)</span></label>
                <input type="text" id="edit_location_details" name="location_details" value="${escapeHtml(item.location_details || "")}" placeholder="Example: Library, SE12, cafeteria">
            </div>
            <div class="form-group">
                <label for="edit_stored_location">Stored location <span class="optional">(optional)</span></label>
                <input type="text" id="edit_stored_location" name="stored_location" value="${escapeHtml(item.stored_location || "")}" placeholder="Example: Locker A1, shelf B2">
            </div>
            <div class="form-group">
                <label for="edit_date_lost">Date lost <span class="optional">(optional)</span></label>
                <input type="date" id="edit_date_lost" name="date_lost" value="${escapeHtml(dl)}">
            </div>
            <div class="form-group">
                <label for="edit_date_found">Date found <span class="optional">(optional)</span></label>
                <input type="date" id="edit_date_found" name="date_found" value="${escapeHtml(df)}">
            </div>
            <div class="form-group full-width">
                <label for="edit_description">Description <span class="optional">(optional)</span></label>
                <textarea id="edit_description" name="description" rows="4" placeholder="Colour, brand, serial number, or other details.">${escapeHtml(item.description || "")}</textarea>
            </div>
            <div class="form-group">
                <label for="edit_claimant_name">Claimant name <span class="optional">(optional)</span></label>
                <input type="text" id="edit_claimant_name" name="claimant_name" value="${escapeHtml(item.claimant_name || "")}" placeholder="If claimed">
            </div>
            <div class="form-group">
                <label for="edit_claimant_contact">Claimant contact <span class="optional">(optional)</span></label>
                <input type="text" id="edit_claimant_contact" name="claimant_contact" value="${escapeHtml(item.claimant_contact || "")}" placeholder="Phone or email">
            </div>
            <div class="form-group full-width">
                <label for="edit_notes">Staff notes <span class="optional">(optional)</span></label>
                <textarea id="edit_notes" name="notes" rows="3" placeholder="Internal notes only.">${escapeHtml(item.notes || "")}</textarea>
            </div>
            ${imgSection}
            <div class="form-group full-width">
                <label for="edit_image">Replace photo <span class="optional">(optional, one image)</span></label>
                <input type="file" id="edit_image" name="image" accept="image/*">
            </div>
            <div class="form-buttons full-width">
                <button type="submit" class="save-btn">Save</button>
                <button type="button" class="cancel-btn" id="catalogEditCancel">Cancel</button>
            </div>
        </form>`;
}

/**
 * Save edits: browser sends multipart FormData exactly like “Add item”, but the verb is PUT on the row id.
 * Leave the file input empty to keep the existing photo; if the server accepts a new file it replaces the old one.
 */
async function onCatalogEditSubmit(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const errEl = document.getElementById("catalogEditError");
    errEl.hidden = true;
    const id = form.dataset.itemId;
    const fd = new FormData(form);
    try {
        const res = await fetch(`/api/admin/items/${id}`, {
            method: "PUT",
            body: fd,
            credentials: "include",
        });
        if (res.status === 401) {
            window.location.href = "/index.html";
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            errEl.textContent = data.error || data.detail || "Save failed";
            errEl.hidden = false;
            return;
        }
        closeCatalogModal();
        loadItems();
    } catch {
        errEl.textContent = "Network error — is the server running?";
        errEl.hidden = false;
    }
}

/**
 * Opens the wide edit layout, pulls the latest row from the API, then drops in the form HTML.
 * Cancel / Save are wired after insert because the nodes did not exist until then.
 */
async function openEditModal(id) {
    modalContent.classList.add("modal-content--edit");
    modal.classList.remove("hidden");
    modalBody.innerHTML = "Loading...";
    try {
        const res = await fetch(`/api/admin/items/${id}`, {
            credentials: "include",
        });
        if (res.status === 401) {
            window.location.href = "/index.html";
            return;
        }
        if (!res.ok) {
            modalBody.innerHTML = "Failed to load item";
            return;
        }
        const item = await res.json();
        modalBody.innerHTML = buildEditFormHtml(item);
        document.getElementById("catalogEditCancel").onclick = () =>
            closeCatalogModal();
        document
            .getElementById("catalogEditForm")
            .addEventListener("submit", onCatalogEditSubmit);
    } catch {
        modalBody.innerHTML = "Error loading item";
    }
}

/** Hides the overlay and resets card width so the next open isn’t stuck in “edit” sizing. */
function closeCatalogModal() {
    modal.classList.add("hidden");
    modalContent.classList.remove("modal-content--edit");
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

    catalogBody.innerHTML = items.map((item) => {

        const showDelete = item.status !== "deleted";

        // View and Edit both use `data-id` with GET /api/admin/items/:id; catalog.js decides read-only vs form.
        return `
            <tr>
                <td>${item.item_name ?? "-"}</td>
                <td>${item.category ?? "-"}</td>
                <td>${formatDate(item.date_reported)}</td>
                <td>${item.campus ?? "-"}</td>
                <td><span class="status ${item.status}">${toTitleCase(item.status)}</span></td>
                <td>
                    <a href="#" class="action-btn view-btn" data-id="${item.id}">View</a>
                    <a href="#" class="action-btn edit-btn" data-id="${item.id}">Edit</a>

                    ${showDelete ? `
                        <a href="#" class="action-btn delete-btn" data-id="${item.id}" data-name="${item.item_name}">
                            Delete
                        </a>
                    ` : ""}
                </td>
            </tr>
        `;
    }).join("");
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

// ! =========== NEW by Gai Deng ===================== 
// modules
// close button
closeModalBtn.onclick = () => {
    closeCatalogModal();
};

// click outside
modal.onclick = (e) => {
    if (e.target === modal) {
        closeCatalogModal();
    }
};

// Same as many desktop apps: Escape closes whatever is in the modal (view, edit form, or delete confirm).
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeCatalogModal();
    }
});
// ! =================== END  ========================

// First paint: load page 1 as soon as script runs.
loadItems();


// ! =========== NEW by Gai Deng =====================
// Read-only detail: narrow card, no form. Strip edit width in case the user opened Edit right before this.
window.openModal = async function (id) {
    modalContent.classList.remove("modal-content--edit");
    modal.classList.remove("hidden");
    modalBody.innerHTML = "Loading...";
    
    try {
        const res = await fetch(`/api/admin/items/${id}`, {
            credentials: "include"
        });
        
        if (!res.ok) {
            modalBody.innerHTML = "Failed to load item";
            return;
        }
        
        const item = await res.json();

        // Read-only strings: escapeHtml so odd characters in item names or notes can’t break the markup.
        // Detail panel for “View”: matches the DB fields we care about on the floor —
        // where it was lost/found vs where it’s stored, reporting + event dates, then claimant info above staff notes.
        modalBody.innerHTML = `
        <h2>${escapeHtml(item.item_name)}</h2>
        
        ${item.image_path ? `
            <img src="${escapeHtml(item.image_path)}"
            style="width:100%;border-radius:8px;margin:10px 0;" />
            ` : ""}
            
            <p><strong>Category:</strong> ${escapeHtml(item.category)}</p>
            <p><strong>Campus:</strong> ${escapeHtml(item.campus)}</p>
            <p><strong>Status:</strong> ${escapeHtml(item.status)}</p>
            <p><strong>Description:</strong> ${escapeHtml(item.description) || "-"}</p>
            <p><strong>Lost/Found Location:</strong> ${escapeHtml(item.location_details) || "-"}</p>
            <p><strong>Storage Location:</strong> ${escapeHtml(item.stored_location) || "-"}</p>
            <p><strong>Date Reported:</strong> ${formatDate(item.date_reported)}</p>
            ${buildItemDateLine(item)}
            <p><strong>Claimant Name:</strong> ${escapeHtml(item.claimant_name) || "-"}</p>
            <p><strong>Claimant Contact:</strong> ${escapeHtml(item.claimant_contact) || "-"}</p>
            <p><strong>Notes:</strong> ${escapeHtml(item.notes) || "-"}</p>
            `;
            
        } catch (err) {
            modalBody.innerHTML = "Error loading item";
        }
    };
    
    // One listener on the table body: branch on which action link was clicked (View vs Edit).
    catalogBody.addEventListener("click", (e) => {
        const viewBtn = e.target.closest(".view-btn");
        if (viewBtn) {
            e.preventDefault();
            window.openModal(viewBtn.dataset.id);
            return;
        }
        const editBtn = e.target.closest(".edit-btn");
        if (editBtn) {
            e.preventDefault();
            openEditModal(editBtn.dataset.id);
        }
});
    
    // ! =================== END  ========================

// Delete handler 

catalogBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;

    e.preventDefault();

    const id = btn.dataset.id;
    const name = btn.dataset.name;

    openDeleteModal(id, name);
});



// ! === DELETE state =====
/** Narrow centred confirm; not the wide edit layout. */
function openDeleteModal(id, name) {
    modalContent.classList.remove("modal-content--edit");
    modal.classList.remove("hidden");

    modalBody.innerHTML = `
        <div style="text-align:center">
            <h3 style="margin-bottom:10px;">Confirm Delete</h3>
            <p style="margin-bottom:20px;">
                Are you sure you want to delete <strong>${name}</strong>?
            </p>

            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="cancelDelete" class="action-btn view-btn">Cancel</button>
                <button id="confirmDelete" class="action-btn delete-btn">Delete</button>
            </div>
        </div>
    `;

    document.getElementById("cancelDelete").onclick = () => {
        closeCatalogModal();
    };

    document.getElementById("confirmDelete").onclick = async () => {
        try {
            const res = await fetch(`/api/admin/items/${id}`, {
                method: "DELETE",
                credentials: "include"
            });

            if (!res.ok) {
                alert("Failed to delete item");
                return;
            }

            closeCatalogModal();

            // refresh table
            loadItems();

        } catch (err) {
            alert("Error deleting item");
        }
    };
}

// ! ==== END =======