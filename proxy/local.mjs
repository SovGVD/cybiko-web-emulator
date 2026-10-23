#!/usr/bin/env node
/* The emulator on your own computer: serves web/, and is its own proxy and
 * radio relay (the same /fetch and /room/NAME as the Cloudflare Worker).
 * Needs Node 18 or newer, no packages.
 *
 *   node proxy/local.mjs [--port 8080] [--host 127.0.0.1]
 *
 * then open http://localhost:8080/ (the page uses this server as its proxy
 * when it is opened from localhost). Other computers can use it too with
 * --host 0.0.0.0, but anyone who can reach it can fetch through it. */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handleFetch, roomName, MAX_ROOM } from "./core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..", "web");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PORT = +opt("--port", 8080);
const HOST = opt("--host", "127.0.0.1");

const log = line => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                ".wasm": "application/wasm", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };

function serveFile(req, res, pathname) {
    const file = path.resolve(WEB, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(WEB + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
                             "Cache-Control": "no-cache" }).end(data);
    });
}

async function proxy(req, res, url) {
    const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
    const headers = {};
    for (const h of ["origin", "x-cookie", "content-type"]) if (req.headers[h]) headers[h] = req.headers[h];
    const request = new Request(url, { method: req.method, headers, body, duplex: "half" });
    const answer = await handleFetch(request, log);
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    if (!answer.body) { res.end(); return; }
    const reader = answer.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
    } catch (e) {
        log(`proxy: ${url}: ${e.message}`);
        res.destroy(e);          /* the page sees a failed read, not a short page */
        return;
    }
    res.end();
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/fetch") {
        proxy(req, res, url.href).catch(e => { log(`proxy: ${e.stack}`); res.destroy(); });
        return;
    }
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    serveFile(req, res, url.pathname);
});

/* ---- the radio relay: a minimal WebSocket server (RFC 6455) ---- */

const rooms = new Map();          /* name -> Set of sockets */

function wsSend(sock, data, binary = true) {
    const len = data.length;
    const head = len < 126 ? Buffer.from([binary ? 0x82 : 0x81, len])
        : len < 65536 ? Buffer.from([binary ? 0x82 : 0x81, 126, len >> 8, len & 255])
        : null;
    if (!head) return;            /* radio frames are never this big */
    sock.write(Buffer.concat([head, data]));
}

server.on("upgrade", (req, sock) => {
    const url = new URL(req.url, "http://x");
    const name = roomName(url.pathname);
    const keyHdr = req.headers["sec-websocket-key"];
    if (!name || !keyHdr) { sock.end("HTTP/1.1 404 Not Found\r\n\r\n"); return; }
    const room = rooms.get(name) || new Set();
    if (room.size >= MAX_ROOM) { sock.end("HTTP/1.1 503 Room full\r\n\r\n"); log(`room ${name}: full, refused`); return; }
    const accept = crypto.createHash("sha1").update(keyHdr + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    rooms.set(name, room);
    room.add(sock);
    log(`room ${name}: joined (${room.size})`);
    let buf = Buffer.alloc(0);
    sock.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
            if (buf.length < 2) return;
            const op = buf[0] & 15, masked = buf[1] & 128;
            let len = buf[1] & 127, at = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
            else if (len === 127) { log(`room ${name}: frame too big, closing`); sock.destroy(); return; }
            if (buf.length < at + (masked ? 4 : 0) + len) return;
            let data = buf.subarray(at + (masked ? 4 : 0), at + (masked ? 4 : 0) + len);
            if (masked) {
                const mask = buf.subarray(at, at + 4);
                data = Buffer.from(data.map((b, i) => b ^ mask[i & 3]));
            }
            buf = buf.subarray(at + (masked ? 4 : 0) + len);
            if (op === 2) {
                for (const other of room) if (other !== sock) wsSend(other, data);
            } else if (op === 8) {
                sock.end(Buffer.from([0x88, 0]));
            } else if (op === 9) {
                sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
            } else if (op !== 10) {
                log(`room ${name}: ignored a frame with opcode ${op} (only binary radio frames are relayed)`);
            }
        }
    });
    const leave = () => {
        if (!room.delete(sock)) return;
        log(`room ${name}: left (${room.size})`);
        if (!room.size) rooms.delete(name);
    };
    sock.on("close", leave);
    sock.on("error", leave);
});

server.listen(PORT, HOST, () => log(`Cybiko web emulator on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/`));
