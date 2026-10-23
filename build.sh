#!/bin/sh
# Builds web/emu.js + web/emu.wasm with Emscripten (emcc on the PATH:
# source emsdk_env.sh first). The C comes from the two submodules:
#   git submodule update --init
set -e
cd "$(dirname "$0")"
DF=deps/dragonfruit/src/components
CB=deps/cybiko-browser
[ -f "$DF/cybiko/cybiko.c" ] && [ -f "$CB/gate/cy_gate.c" ] || {
    echo "the submodules are missing: git submodule update --init" >&2; exit 1; }

emcc -O3 -std=gnu11 -D_GNU_SOURCE -Wall -Wno-format-truncation \
    -I$DF/cybiko/include -I$DF/cybiko -I$DF/h8s/include \
    -I$CB/include -I$CB/gate -I$CB/src -I$CB/third_party/tjpgd -Isrc \
    src/emu.c src/net_web.c \
    $DF/cybiko/cybiko.c $DF/cybiko/cy_periph.c $DF/cybiko/cy_devices.c $DF/cybiko/cy_dma.c \
    $DF/cybiko/cy_disk.c $DF/cybiko/cy_hle.c $DF/cybiko/cy_rf.c $DF/cybiko/cy_cart.c \
    $DF/h8s/h8s.c \
    $CB/src/cy_browser.c $CB/src/cyb_cookie.c $CB/src/cyb_css.c $CB/src/cyb_font.c $CB/src/cyb_html.c \
    $CB/src/cyb_image.c $CB/src/cyb_layout.c $CB/src/cyb_text.c $CB/src/cyb_url.c \
    $CB/third_party/tjpgd/tjpgd.c \
    $CB/gate/cy_deflate.c $CB/gate/cy_gate.c $CB/gate/cy_page.c $CB/gate/cy_wml.c \
    -sMODULARIZE=1 -sEXPORT_NAME=CybikoModule -sENVIRONMENT=web,worker \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=32MB -sSTACK_SIZE=1MB \
    -sEXPORTED_FUNCTIONS=_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString,stringToUTF8,stringToNewUTF8 \
    -o web/emu.js
ls -l web/emu.js web/emu.wasm
