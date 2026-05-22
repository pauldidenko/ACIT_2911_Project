/* account.js - admin profile, item counts, MFA setup (must be logged in) */

/* Fill the four stat boxes from GET /api/admin/stats */
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
        /* Network error - leave "-" on the page */
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "-";
        }
        return;
    }
    if (response.status === 401) {
        /* Session expired - go home */
        window.location.href = "/index.html";
        return;
    }
    if (!response.ok) {
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "-";
        }
        return;
    }
    let data;
    try {
        data = await response.json();
    } catch (_error) {
        for (const [elId] of ids) {
            const el = document.getElementById(elId);
            if (el) el.textContent = "-";
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

/* Only one of Set up / Disable is active at a time */
function setMfaButtonsState(setupBtn, disableBtn, enabled) {
    if (setupBtn) setupBtn.disabled = enabled;
    if (disableBtn) disableBtn.disabled = !enabled;
}

/** Ask the server if MFA is on, update the status line, and enable the correct button. */
async function loadMfaStatus() {
    const statusText = document.getElementById("mfaStatusText");
    const setupBtn = document.getElementById("mfaSetupBtn");
    const disableBtn = document.getElementById("mfaDisableBtn");

    if (setupBtn) setupBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = true;

    try {
        const response = await fetch("/api/admin/2fa/status", {
            credentials: "include",
        });
        if (response.status === 401) {
            window.location.href = "/index.html";
            return;
        }
        if (!response.ok) {
            if (statusText) statusText.textContent = "Could not load MFA status.";
            return;
        }
        const data = await response.json();
        const enabled = Boolean(data.has2FA);
        if (statusText) {
            statusText.textContent = enabled
                ? "MFA is enabled. Sign-in requires a code from your authenticator app."
                : "MFA is not enabled. Set it up to require a 6-digit code when you log in.";
        }
        setMfaButtonsState(setupBtn, disableBtn, enabled);
    } catch (_error) {
        if (statusText) statusText.textContent = "Could not load MFA status.";
    }
}

/* MFA setup modal: QR from server, user enters code, verify then enable */
function wireMfaSetupModal() {
    const overlay = document.getElementById("mfaSetupOverlay");
    const setupBtn = document.getElementById("mfaSetupBtn");
    const disableBtn = document.getElementById("mfaDisableBtn");
    const closeBtn = document.getElementById("mfaSetupCloseBtn");
    const cancelBtn = document.getElementById("mfaSetupCancelBtn");
    const confirmBtn = document.getElementById("mfaSetupConfirmBtn");
    const qrImage = document.getElementById("mfaQrImage");
    const manualKey = document.getElementById("mfaManualKey");
    const codeInput = document.getElementById("mfaSetupCode");
    const errorEl = document.getElementById("mfaSetupError");

    if (!overlay || !setupBtn) return;

    function closeModal() {
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        if (codeInput) codeInput.value = "";
        if (errorEl) errorEl.textContent = "";
        if (qrImage) {
            qrImage.hidden = true;
            qrImage.removeAttribute("src");
        }
        if (manualKey) manualKey.textContent = "";
    }

    async function openModal() {
        if (errorEl) errorEl.textContent = "";
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        if (codeInput) codeInput.value = "";

        try {
            const response = await fetch("/api/admin/2fa/setup", {
                credentials: "include",
            });
            const data = await response.json();
            if (!response.ok) {
                if (errorEl) errorEl.textContent = data.error || "Failed to start MFA setup";
                return;
            }
            if (manualKey) manualKey.textContent = data.manualEntryKey || data.secret || "";
            if (qrImage && data.qrCode) {
                qrImage.src = data.qrCode;
                qrImage.hidden = false;
            } else if (qrImage) {
                qrImage.hidden = true;
            }
            requestAnimationFrame(() => codeInput && codeInput.focus());
        } catch (_error) {
            if (errorEl) errorEl.textContent = "Unable to reach server";
        }
    }

    setupBtn.addEventListener("click", () => {
        if (setupBtn.disabled) return;
        void openModal();
    });

    for (const btn of [closeBtn, cancelBtn]) {
        if (btn) btn.addEventListener("click", closeModal);
    }

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && overlay.classList.contains("is-open")) {
            closeModal();
        }
    });

    /* Enable MFA button and Enter key both run this */
    async function confirmMfaSetup() {
        if (errorEl) errorEl.textContent = "";
        const totpCode = codeInput ? codeInput.value.trim() : "";
        if (totpCode.length !== 6) {
            if (errorEl) errorEl.textContent = "Enter the 6-digit code from your app";
            return;
        }

        try {
            const verifyRes = await fetch("/api/admin/2fa/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ totpCode }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) {
                if (errorEl) errorEl.textContent = verifyData.error || "Invalid code";
                return;
            }

            const enableRes = await fetch("/api/admin/2fa/enable", {
                method: "POST",
                credentials: "include",
            });
            const enableData = await enableRes.json();
            if (!enableRes.ok) {
                if (errorEl) errorEl.textContent = enableData.error || "Failed to enable MFA";
                return;
            }

            closeModal();
            await loadMfaStatus();
        } catch (_error) {
            if (errorEl) errorEl.textContent = "Unable to reach server";
        }
    }

    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            void confirmMfaSetup();
        });
    }

    // Enter in the setup code box = same as clicking Enable MFA.
    if (codeInput) {
        codeInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void confirmMfaSetup();
        });
    }

    if (disableBtn) {
        disableBtn.addEventListener("click", async () => {
            if (disableBtn.disabled) return;
            const ok = globalThis.confirm(
                "Disable MFA? You will only need your password to log in.",
            );
            if (!ok) return;

            try {
                const response = await fetch("/api/admin/2fa/disable", {
                    method: "POST",
                    credentials: "include",
                });
                const data = await response.json();
                if (!response.ok) {
                    globalThis.alert(data.error || "Failed to disable MFA");
                    return;
                }
                await loadMfaStatus();
            } catch (_error) {
                globalThis.alert("Unable to reach server");
            }
        });
    }
}

async function initAccountPage() {
    let data;
    try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        data = await response.json();
    } catch (_error) {
        /* Can't reach server - treat as logged out */
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

    if (typeof AppAuth !== "undefined") {
        AppAuth.wireStandardLogoutById();
    }

    wireMfaSetupModal();
    await loadMfaStatus();
    await loadAccountStats();
}

void initAccountPage();
