/* The gate's network in a web page (see net_web.h). The page's side is
 * Module.net in web/app.js: it fetches one step through the proxy and hands
 * back the status, Location, Set-Cookie headers and the body as it comes. */
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "net_web.h"

bool cyb_url_resolve(const char *base, const char *href, char *out, size_t cap);   /* cybiko-browser src/cyb_url.c */

EM_JS(int, js_net_start, (const char *url, const char *body, const char *ctype, const char *cookie), {
    return Module.net.start(UTF8ToString(url), body ? UTF8ToString(body) : null,
                            ctype ? UTF8ToString(ctype) : null, UTF8ToString(cookie)) ? 1 : 0;
});
/* 0 still waiting, 1 the headers are in, -2 failed */
EM_JS(int, js_net_poll, (void), { return Module.net.poll(); });
/* A header of the answer: "status", "location", "type", "url", "error", or
 * "cookie<n>" for the n-th Set-Cookie (empty when there is none). */
EM_JS(void, js_net_get, (const char *what, char *out, int cap), {
    stringToUTF8(Module.net.get(UTF8ToString(what)) || "", out, cap);
});
EM_JS(int, js_net_read, (uint8_t *buf, int cap), {
    const r = Module.net.read(cap);
    if (typeof r === "number") return r;
    HEAPU8.set(r, buf);
    return r.length;
});
EM_JS(void, js_net_abort, (void), { Module.net.abort(); });

#define REDIRECTS 6

typedef struct {
    bool busy, headers;
    int hops;
    cyb_jar_t *jar;
    char url[1024];
    char body[4096];
    bool has_body;
    char ctype_req[128];
    char final_url[1024];
    char content_type[128];
    char error[160];
} web_t;

static web_t the_web;

static bool start_hop(web_t *w)
{
    char cookie[4096] = "";
    if (w->jar) cyb_jar_header(w->jar, w->url, cookie, sizeof cookie);
    w->headers = false;
    if (js_net_start(w->url, w->has_body ? w->body : NULL, w->has_body ? w->ctype_req : NULL, cookie)) return true;
    js_net_get("error", w->error, sizeof w->error);
    if (!w->error[0]) snprintf(w->error, sizeof w->error, "Can't fetch");
    return false;
}

static void web_close(void *user)
{
    web_t *w = user;
    if (w->busy) js_net_abort();
    w->busy = false;
}

static bool web_open(void *user, const char *url, const char *body, const char *content_type, cyb_jar_t *jar)
{
    web_t *w = user;
    web_close(w);
    w->final_url[0] = w->content_type[0] = w->error[0] = 0;
    w->jar = jar;
    w->hops = 0;
    snprintf(w->url, sizeof w->url, "%s", url);
    w->has_body = body != NULL;
    if (body && strlen(body) >= sizeof w->body) {
        snprintf(w->error, sizeof w->error, "Form too big");
        return false;
    }
    if (body) snprintf(w->body, sizeof w->body, "%s", body);
    snprintf(w->ctype_req, sizeof w->ctype_req, "%s", content_type ? content_type : "application/x-www-form-urlencoded");
    if (!start_hop(w)) return false;
    w->busy = true;
    return true;
}

/* The headers of a step are in: take its cookies and follow a redirect. 1
 * the body follows, 0 another step started, CYB_FAIL failed. */
static int take_headers(web_t *w)
{
    char v[4096];
    for (int i = 0;; i++) {
        char name[16];
        snprintf(name, sizeof name, "cookie%d", i);
        js_net_get(name, v, sizeof v);
        if (!v[0]) break;
        if (w->jar) cyb_jar_set(w->jar, w->url, v);
    }
    js_net_get("status", v, sizeof v);
    int status = atoi(v);
    char loc[1024];
    js_net_get("location", loc, sizeof loc);
    if (status >= 300 && status < 400 && loc[0]) {
        char next[1024];
        if (++w->hops > REDIRECTS) { snprintf(w->error, sizeof w->error, "Too many redirects"); return CYB_FAIL; }
        if (!cyb_url_resolve(w->url, loc, next, sizeof next)) snprintf(next, sizeof next, "%s", loc);
        snprintf(w->url, sizeof w->url, "%s", next);
        if (status != 307 && status != 308) w->has_body = false;
        if (!start_hop(w)) return CYB_FAIL;
        return 0;
    }
    js_net_get("url", w->final_url, sizeof w->final_url);
    if (!w->final_url[0]) snprintf(w->final_url, sizeof w->final_url, "%s", w->url);
    js_net_get("type", w->content_type, sizeof w->content_type);
    w->headers = true;
    return 1;
}

static int web_read(void *user, uint8_t *buf, int cap)
{
    web_t *w = user;
    if (!w->busy) return CYB_FAIL;
    if (!w->headers) {
        int s = js_net_poll();
        if (s == 0) return 0;
        if (s < 0) {
            js_net_get("error", w->error, sizeof w->error);
            if (!w->error[0]) snprintf(w->error, sizeof w->error, "Failed");
            w->busy = false;
            return CYB_FAIL;
        }
        int r = take_headers(w);
        if (r <= 0) {
            if (r < 0) w->busy = false;
            return r;
        }
    }
    int n = js_net_read(buf, cap);
    if (n == CYB_FAIL) {
        js_net_get("error", w->error, sizeof w->error);
        if (!w->error[0]) snprintf(w->error, sizeof w->error, "Failed");
    }
    if (n < 0) w->busy = false;
    return n;
}

static const char *web_final(void *user) { return ((web_t *)user)->final_url; }
static const char *web_type(void *user) { return ((web_t *)user)->content_type; }
static const char *web_error(void *user) { return ((web_t *)user)->error; }

void net_web_init(cyb_net_t *net)
{
    memset(net, 0, sizeof *net);
    net->user = &the_web;
    net->open = web_open;
    net->read = web_read;
    net->close = web_close;
    net->final_url = web_final;
    net->content_type = web_type;
    net->error = web_error;
}
