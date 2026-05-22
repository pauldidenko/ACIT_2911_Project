/* catalog.js - admin item table: filters, pagination, view/edit/delete popup */

/* Shared modal for View, Edit, and Delete confirm */
const modal = document.getElementById("viewModal");
const modalContent = document.getElementById("modalContent");
const modalBody = document.getElementById("modalBody");
const closeModalBtn = document.getElementById("closeModal");

const PAGE_SIZE = 10;
let currentPage = 1;
let currentTotalPages = 1;

/* Filter and table elements */
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
const resetFiltersBtn = document.getElementById("resetFiltersBtn");

function formatDate(value) {
    if (!value) return "-";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleDateString();
}

function toTitleCase(value) {
    if (!value) return "-";
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/*
 * View modal: show date lost or date found.
 * If both dates exist, use status (found vs lost) to pick which label to show.
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

/* Edit form helpers (same fields as add-item page) */

/* Stop user input from breaking HTML attributes */
function escapeHtml(text) {
    if (text == null || text === "") return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

/* Trim server datetime to yyyy-mm-dd for date inputs */
function dateInputValue(raw) {
    if (!raw) return "";
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

/* Must match schema.sql category list */
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

function optionSelected(value, current) {
    return value === current ? " selected" : "";
}

/* Build edit form HTML from item JSON - escapeHtml on all user fields */
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

/* PUT multipart save - empty file field keeps the old photo */
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
        errEl.textContent = "Network error - is the server running?";
        errEl.hidden = false;
    }
}

/* Load item by id and show edit form in the modal */
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

function closeCatalogModal() {
    modal.classList.add("hidden");
    modalContent.classList.remove("modal-content--edit");
}

function renderRows(items) {
    if (!items.length) {
        catalogBody.innerHTML = '<tr><td colspan="6">No items found.</td></tr>';
        return;
    }

    catalogBody.innerHTML = items.map((item) => {

        const showDelete = item.status !== "deleted";

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

function updatePagination(page, totalPages) {
    currentPage = page;
    currentTotalPages = totalPages;
    pageInfo.textContent = `Page ${page} of ${totalPages}`;
    prevPageBtn.disabled = page <= 1;
    nextPageBtn.disabled = page >= totalPages;
}

/* GET /api/admin/items with current filters and page */
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

    /* 401 = not logged in */
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

/* Reset to page 1 when filters change */
function onFilterChange() {
    currentPage = 1;
    loadItems();
}

/* Wait 250ms after typing before searching */
let searchDebounce;
searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(onFilterChange, 250);
});

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

if (typeof AppAuth !== "undefined") {
    AppAuth.wireStandardLogoutById();
}

/* Close modal: X button, click backdrop, Escape */
closeModalBtn.onclick = () => {
    closeCatalogModal();
};

modal.onclick = (e) => {
    if (e.target === modal) {
        closeCatalogModal();
    }
};

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        closeCatalogModal();
    }
});

loadItems();

/* View item - read-only detail in the modal */
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

/* View / Edit clicks on table rows */
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

/* Delete button - soft delete (status = deleted) */
catalogBody.addEventListener("click", (e) => {
    const btn = e.target.closest(".delete-btn");
    if (!btn) return;

    e.preventDefault();

    const id = btn.dataset.id;
    const name = btn.dataset.name;

    openDeleteModal(id, name);
});



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

            loadItems();

        } catch (err) {
            alert("Error deleting item");
        }
    };
}
