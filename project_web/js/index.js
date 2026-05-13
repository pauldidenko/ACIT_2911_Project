/**
 * index.js — Home page: session check, login modal, and nav tabs (public: Home + Login;
 * logged-in: Home, Catalog, Account, Logout). Dynamic tables for recent items TBD.
 */

const overlayEl = document.getElementById("loginOverlay");
const loginCardEl = document.getElementById("loginCard");
const formEl = document.getElementById("adminLoginForm");
const errorEl = document.getElementById("loginError");
const sessionNavBtn = document.getElementById("sessionNavBtn");
const closeLoginBtn = document.getElementById("closeLoginBtn");
const navCatalogItem = document.getElementById("navCatalogItem");
const navAccountItem = document.getElementById("navAccountItem");
const navQuickCatalog = document.getElementById("navQuickCatalog");
const navQuickAccount = document.getElementById("navQuickAccount");

/** @type {boolean} */
let isAuthenticated = false;

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

async function refreshSession() {
    try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        const data = await response.json();
        setAuthenticated(Boolean(data.authenticated));
    } catch (_error) {
        setAuthenticated(false);
    }
}

async function initIndexLogin() {
    if (!sessionNavBtn || !formEl) {
        return;
    }

    await refreshSession();
    closeLoginOverlay();

    sessionNavBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        if (isAuthenticated) {
            try {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include"
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
                body: JSON.stringify({ username, password })
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

void initIndexLogin();
