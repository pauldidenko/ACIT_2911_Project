/**
 * add-item.js — behaviour for `add-item.html` (staff “create catalog item” form).
 *
 * Teammates:
 * - Form submits via `fetch` to POST `/api/admin/items` with `FormData` (multipart: fields + optional file field `image`).
 * - You must be logged in as admin (session cookie); 401 → redirect to login.
 * - `resolveApiBase()` finds the Node server when the HTML is opened from Live Server or another port:
 *   probes GET `/api/auth/session`, uses `<meta name="app-api-origin">`, or scans common ports.
 * - When you open the page through Express (`npm start`), the server injects `app-api-origin` and same-origin fetch works.
 * - Success → banner + redirect to `catalog.html`; errors → `#pageBanner` message at top.
 */
const form = document.getElementById("addItemForm");
const pageBanner = document.getElementById("pageBanner");
const logoutBtn = document.getElementById("logoutBtn");

/** Cached API base: "" = same origin, or full origin like http://localhost:3000 */
let cachedApiBase;

/**
 * Detect where Express is running by probing GET /api/auth/session (JSON).
 * Fixes Live Server / other static hosts sending POST to the wrong port.
 */
async function probeSession(base) {
    const url =
        base === "" || base == null
            ? "/api/auth/session"
            : `${String(base).replace(/\/$/, "")}/api/auth/session`;
    try {
        const r = await fetch(url, {
            credentials: "include",
            mode: base ? "cors" : "same-origin",
        });
        const text = await r.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return null;
        }
        if (data && typeof data.authenticated === "boolean") {
            return base === "" || base == null ? "" : String(base).replace(/\/$/, "");
        }
    } catch {
        return null;
    }
    return null;
}

async function resolveApiBase() {
    if (cachedApiBase !== undefined) return cachedApiBase;

    const meta = document.querySelector('meta[name="app-api-origin"]');
    const fromMeta = meta?.getAttribute("content")?.trim().replace(/\/$/, "") || "";

    const { protocol, hostname } = window.location;

    // Server-injected meta (see app.js GET /add-item.html) — same origin, use relative API URLs.
    if (protocol.startsWith("http") && fromMeta && fromMeta === window.location.origin) {
        cachedApiBase = "";
        return cachedApiBase;
    }

    if (protocol === "file:") {
        const candidates = [
            fromMeta,
            "http://localhost:5000",
            "http://localhost:3000",
            "http://127.0.0.1:5000",
            "http://127.0.0.1:3000",
        ].filter(Boolean);
        for (const base of [...new Set(candidates)]) {
            const found = await probeSession(base);
            if (found !== null) {
                cachedApiBase = found;
                return cachedApiBase;
            }
        }
        cachedApiBase = fromMeta || "http://localhost:5000";
        return cachedApiBase;
    }

    // 1) Page served by Express on the same host/port as the API
    let found = await probeSession("");
    if (found !== null) {
        cachedApiBase = found;
        return cachedApiBase;
    }

    // 2) Meta tag (explicit Live Server → Node URL)
    if (fromMeta) {
        found = await probeSession(fromMeta);
        if (found !== null) {
            cachedApiBase = found;
            return cachedApiBase;
        }
    }

    // 3) Try typical Express ports (matches PORT in .env)
    const ports = [5000, 3000, 8080, 4000];
    const hosts = [...new Set([hostname, "localhost", "127.0.0.1"])];
    const current = window.location.origin.replace(/\/$/, "");

    for (const h of hosts) {
        for (const p of ports) {
            const base = `http://${h}:${p}`;
            if (base === current) continue;
            found = await probeSession(base);
            if (found !== null) {
                cachedApiBase = found;
                return cachedApiBase;
            }
        }
    }

    cachedApiBase = "";
    return cachedApiBase;
}

async function apiUrl(path) {
    const base = await resolveApiBase();
    const p = path.startsWith("/") ? path : `/${path}`;
    return base ? `${base}${p}` : p;
}

function scrollToTopAndShowBanner() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function showBanner(kind, message) {
    pageBanner.textContent = message;
    pageBanner.hidden = false;
    pageBanner.classList.remove("success", "error");
    pageBanner.classList.add(kind === "success" ? "success" : "error");
    scrollToTopAndShowBanner();
}

function hideBanner() {
    pageBanner.hidden = true;
    pageBanner.textContent = "";
    pageBanner.classList.remove("success", "error");
}

/** Turn Express HTML error pages into a short plain-text hint. */
function humanizeErrorBody(raw, status) {
    if (!raw || !raw.trim()) {
        return status === 404
            ? "API not found. Start the app with npm start and open add-item using the URL the terminal prints."
            : "Request failed.";
    }
    const pre = raw.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (pre) {
        const inner = pre[1].replace(/<[^>]+>/g, "").trim();
        if (inner.includes("Cannot POST")) {
            return "Save failed: POST hit a server without this route. Run npm start, then use that URL (or set app-api-origin if you use Live Server).";
        }
        return inner;
    }
    if (/^\s*</.test(raw)) {
        return "Server returned HTML instead of JSON — is Express running?";
    }
    return raw.trim().slice(0, 400);
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideBanner();

    const formData = new FormData(form);

    try {
        const postUrl = await apiUrl("/api/admin/items");
        const response = await fetch(postUrl, {
            method: "POST",
            body: formData,
            credentials: "include",
        });

        if (response.status === 401) {
            window.location.href = await apiUrl("/index.html");
            return;
        }

        const raw = await response.text();
        let data = {};
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = {};
        }

        if (!response.ok) {
            const msg =
                data.error ||
                data.detail ||
                humanizeErrorBody(raw, response.status);
            showBanner("error", msg);
            return;
        }

        showBanner(
            "success",
            "Item saved successfully. Redirecting to the catalog…",
        );
        setTimeout(async () => {
            window.location.href = await apiUrl("/catalog.html");
        }, 1600);
    } catch (_err) {
        showBanner(
            "error",
            "Network error — run npm start and open this site from that URL.",
        );
    }
});

logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
        await fetch(await apiUrl("/api/auth/logout"), {
            method: "POST",
            credentials: "include",
        });
    } catch (_e) {
        /* ignore */
    }
    window.location.href = await apiUrl("/index.html");
});
