/* What the proxy does, shared by the Cloudflare Worker (worker.mjs) and the
 * local server (local.mjs). Standard fetch API only.
 *
 * GET or POST /fetch?url=URL, with the request's cookies in X-Cookie,
 * fetches one step (no redirect following: the page follows them, so that
 * every step gets and sets its own cookies) and answers 200 with the body
 * and these headers (or 502 with X-Error):
 *   X-Status        the site's HTTP status
 *   X-Location      its Location header (redirects)
 *   X-Content-Type  its Content-Type
 *   X-Final-Url     the URL fetched
 *   X-Set-Cookie    its Set-Cookie headers, a JSON array, URI-encoded
 *
 * The radio relay (/room/NAME) is a WebSocket: each binary message is sent
 * to everyone else in the room as it is. */

export const MAX_BODY = 4 * 1024 * 1024;
export const MAX_ROOM = 32;
const AGENT = "Mozilla/5.0 (compatible; Cybiko Xtreme; CyOS 1.5) cybiko-web-emulator";

export function cors(origin) {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "X-Cookie, Content-Type",
        "Access-Control-Expose-Headers": "X-Status, X-Location, X-Content-Type, X-Final-Url, X-Set-Cookie, X-Error",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

/* allowed: a list of page origins that may use the proxy ("" or [] = any). */
export function originAllowed(request, allowed) {
    const list = (Array.isArray(allowed) ? allowed : String(allowed || "").split(","))
        .map(s => s.trim()).filter(Boolean);
    if (!list.length) return true;
    const origin = request.headers.get("Origin");
    return !!origin && list.includes(origin);
}

function fail(status, why, origin) {
    return new Response(why, { status, headers: { ...cors(origin), "X-Error": why, "Content-Type": "text/plain" } });
}

export async function handleFetch(request, log = () => {}) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "GET" && request.method !== "POST") return fail(405, "Only GET and POST", origin);
    const target = new URL(request.url).searchParams.get("url") || "";
    let url;
    try { url = new URL(target); } catch { return fail(400, "Bad URL", origin); }
    if (url.protocol !== "http:" && url.protocol !== "https:") return fail(400, "Only http and https", origin);

    const headers = { "User-Agent": AGENT, "Accept": "text/html, text/vnd.wap.wml, image/*, */*;q=0.5" };
    const cookie = request.headers.get("X-Cookie");
    if (cookie) headers.Cookie = cookie;
    let body;
    if (request.method === "POST") {
        body = await request.arrayBuffer();
        if (body.byteLength > 64 * 1024) return fail(413, "Form too big", origin);
        headers["Content-Type"] = request.headers.get("Content-Type") || "application/x-www-form-urlencoded";
    }
    let res;
    try {
        res = await fetch(url.href, { method: request.method, headers, body, redirect: "manual" });
    } catch (e) {
        log(`fetch ${url.href}: ${e.message}`);
        return fail(502, `Can't reach ${url.host}`, origin);
    }
    const len = +res.headers.get("Content-Length") || 0;
    if (len > MAX_BODY) return fail(502, "Page too big", origin);
    const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie()
        : (res.headers.get("Set-Cookie") ? [res.headers.get("Set-Cookie")] : []);
    let seen = 0;
    const limit = new TransformStream({
        transform(chunk, ctl) {
            seen += chunk.byteLength;
            if (seen > MAX_BODY) { ctl.error(new Error("Page too big")); return; }
            ctl.enqueue(chunk);
        },
    });
    log(`${request.method} ${url.href} -> ${res.status}`);
    return new Response(res.body ? res.body.pipeThrough(limit) : null, {
        status: 200,
        headers: {
            ...cors(origin),
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Status": String(res.status),
            "X-Location": res.headers.get("Location") || "",
            "X-Content-Type": res.headers.get("Content-Type") || "",
            "X-Final-Url": url.href,
            "X-Set-Cookie": encodeURIComponent(JSON.stringify(setCookie)),
        },
    });
}

/* A room name from /room/NAME: letters, digits, - and _, up to 32. */
export function roomName(path) {
    const m = /^\/room\/([A-Za-z0-9_-]{1,32})$/.exec(path);
    return m ? m[1].toLowerCase() : null;
}
