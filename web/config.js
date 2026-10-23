/* Defaults for this site; every visitor can change them in Settings.
 * proxy: the Cloudflare Worker from proxy/ (internet and the radio relay).
 * files: where "Start the Cybiko" and "Get software" fetch the dumps and the
 * CD software (a copy of github.com/SovGVD/cybiko-roms). */
"use strict";
const SITE = {
    proxy: "https://cybiko-relay.sovgvd.workers.dev",
    room: "public",
    files: "https://raw.githubusercontent.com/SovGVD/cybiko-roms/main/",
    filesPage: "https://github.com/SovGVD/cybiko-roms",
};
