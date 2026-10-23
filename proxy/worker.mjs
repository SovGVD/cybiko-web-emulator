/* The Cloudflare Worker: the gate's internet (/fetch) and the radio relay
 * (/room/NAME), see core.mjs. Each room is a Durable Object that passes
 * every binary message to the other sockets in it; it keeps nothing.
 * Deploy: see README.md (wrangler deploy). */
import { handleFetch, roomName, originAllowed, cors, MAX_ROOM } from "./core.mjs";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!originAllowed(request, env.ALLOW_ORIGINS)) {
            return new Response("This proxy is for the Cybiko web emulator only", { status: 403, headers: cors() });
        }
        if (url.pathname === "/fetch") return handleFetch(request, line => console.log(line));
        const name = roomName(url.pathname);
        if (name) {
            if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket only", { status: 426 });
            return env.ROOMS.get(env.ROOMS.idFromName(name)).fetch(request);
        }
        if (url.pathname === "/") {
            return new Response("Cybiko web emulator proxy and radio relay: /fetch?url=..., /room/NAME\n",
                                { headers: { ...cors(), "Content-Type": "text/plain" } });
        }
        return new Response("Not found", { status: 404 });
    },
};

export class Room {
    constructor(state) {
        this.state = state;
    }

    async fetch() {
        if (this.state.getWebSockets().length >= MAX_ROOM) return new Response("Room full", { status: 503 });
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1]);    /* hibernates while nobody talks */
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    webSocketMessage(ws, message) {
        if (typeof message === "string") {
            console.log(`room: ignored a text message (${message.length} chars); only binary radio frames are relayed`);
            return;
        }
        for (const other of this.state.getWebSockets()) {
            if (other === ws) continue;
            try { other.send(message); } catch (e) { console.log(`room: send failed: ${e.message}`); }
        }
    }

    webSocketClose(ws, code, reason) {
        try { ws.close(code, reason); } catch { /* already closed */ }
    }

    webSocketError(ws, error) {
        console.log(`room: socket error: ${error}`);
    }
}
