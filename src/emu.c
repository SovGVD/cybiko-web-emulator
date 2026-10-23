/* The Cybiko Xtreme emulator in a web page: the machine from Dragonfruit
 * (deps/dragonfruit/src/components/cybiko) and the CyWIG gate from
 * cybiko-browser (deps/cybiko-browser/gate), built with Emscripten.
 *
 * The page (web/app.js) owns the files and the timing: it puts the ROM,
 * flash and RAM disk into buffers from here, calls emu_run every frame and
 * draws emu_lcd. Everything else the machine does comes out through the JS
 * functions below: debug text, sound, radio packets and log lines.
 *
 * Radio: what this Cybiko sends goes to its own gate and to the page, which
 * passes it to the other Cybikos (other tabs, the relay). What comes back
 * from them goes to this Cybiko only. The gate is heard by this Cybiko only,
 * so every tab has its own internet and nobody sees anyone else's gate. */
#include <emscripten.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cybiko.h"
#include "cy_gate.h"
#include "cy_browser_app.h"
#include "net_web.h"

EM_JS(void, js_log, (const char *line), { Module.onLog(UTF8ToString(line)); });
EM_JS(void, js_speaker, (float freq, float duty), { Module.onSpeaker(freq, duty); });
EM_JS(void, js_rf_send, (const uint8_t *pkt, int len, int ch), {
    Module.onRadio(HEAPU8.slice(pkt, pkt + len), ch);
});
EM_JS(double, js_wall_time, (void), {
    const d = new Date();
    return Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60;   /* the Cybiko shows local time */
});

static cybiko_t m;
static uint8_t *rom, *flash, *ram, *disk;
static uint32_t disk_size;
static cy_gate_t *gate;
static cyb_net_t net;
static bool started;
static uint8_t lum[CY_LCD_W * CY_LCD_H];
static uint32_t rf_full;            /* packets the radio queue had no room for */

static void logf_(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void logf_(const char *fmt, ...)
{
    char line[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(line, sizeof line, fmt, ap);
    va_end(ap);
    js_log(line);
}

/* ---- buffers the page fills before emu_start ---- */

EMSCRIPTEN_KEEPALIVE uint8_t *emu_rom(void)
{
    if (!rom) rom = calloc(1, CY_ROM_BUF);
    return rom;
}

EMSCRIPTEN_KEEPALIVE uint8_t *emu_flash(void)
{
    if (!flash) flash = calloc(1, CY_FLASH_SIZE);
    return flash;
}

/* size: a multiple of 64 KB up to CY_DISK_MAX (rounded and clamped here). */
EMSCRIPTEN_KEEPALIVE uint8_t *emu_disk(uint32_t size)
{
    size = (size + 0xffff) & ~0xffffu;
    if (size < CY_RAMDISK_SIZE) size = CY_RAMDISK_SIZE;
    if (size > CY_DISK_MAX) size = CY_DISK_MAX;
    if (!disk || size != disk_size) {
        free(disk);
        disk = calloc(1, size);
        disk_size = size;
    }
    return disk;
}

EMSCRIPTEN_KEEPALIVE uint32_t emu_disk_size(void) { return disk_size; }

/* A scratch buffer for passing files and packets in. */
static uint8_t *scratch;
static size_t scratch_cap;
EMSCRIPTEN_KEEPALIVE uint8_t *emu_scratch(uint32_t len)
{
    if (len > scratch_cap) {
        free(scratch);
        scratch = malloc(len);
        scratch_cap = scratch ? len : 0;
    }
    return scratch;
}

/* ---- files on the RAM disk (before or after start) ---- */

/* Copies a file (in the scratch buffer) to the RAM disk: 0, -1 no room,
 * -2 bad name. */
EMSCRIPTEN_KEEPALIVE int emu_disk_put(const char *name, uint32_t len)
{
    uint32_t date = (uint32_t)((int64_t)js_wall_time() + 2208988800LL);   /* 1970 -> 1900 */
    int r = cy_disk_write(disk, disk_size, name, scratch, len, date);
    logf_("disk: %s (%u bytes) %s", name, (unsigned)len,
          r == 0 ? "copied" : r == -1 ? "does not fit" : "has a bad name");
    return r;
}

static bool list_one(void *user, const cy_disk_file_t *f)
{
    char *out = user;
    size_t n = strlen(out);
    if (n + strlen(f->name) + 16 < 8192) snprintf(out + n, 8192 - n, "%s\t%u\n", f->name, (unsigned)f->size);
    return true;
}

/* The files on the disk, one "name\tsize" a line. */
EMSCRIPTEN_KEEPALIVE const char *emu_disk_list(void)
{
    static char out[8192];
    out[0] = 0;
    cy_disk_list(disk, disk_size, list_one, out);
    return out;
}

EMSCRIPTEN_KEEPALIVE uint32_t emu_disk_free(void) { return cy_disk_free(disk, disk_size); }

/* Puts the native Browser app (cybiko-browser cyapp/) on the disk unless the
 * same one is there. */
static void install_browser(void)
{
    cy_disk_file_t f;
    if (cy_disk_find(disk, disk_size, "Browser.app", &f) && f.size == sizeof cy_browser_app) {
        uint8_t *have = malloc(sizeof cy_browser_app);
        bool same = have && cy_disk_read(disk, disk_size, "Browser.app", have, sizeof cy_browser_app) ==
                                (int32_t)sizeof cy_browser_app &&
                    !memcmp(have, cy_browser_app, sizeof cy_browser_app);
        free(have);
        if (same) return;
    }
    memcpy(emu_scratch(sizeof cy_browser_app), cy_browser_app, sizeof cy_browser_app);
    emu_disk_put("Browser.app", sizeof cy_browser_app);
}

/* A CyOS update (.boot, in the scratch buffer) staged into the flash before
 * start: returns a CY_BOOT_ value. */
EMSCRIPTEN_KEEPALIVE int emu_stage_boot(uint32_t len)
{
    int r = cybiko_flash_stage_boot(flash, scratch, len);
    logf_("CyOS update: %s", r == CY_BOOT_OK ? "installing" : r == CY_BOOT_TOO_BIG ? "too big" :
                             r == CY_BOOT_NO_LOADER ? "no CyOS flash to install it on" : "not a CyOS update image");
    return r;
}

/* ---- the machine ---- */

static char con[256];
static size_t con_len;

static void on_tx(void *user, int port, uint8_t b)
{
    (void)user;
    if (port != 1) return;              /* SCI2 is the radio, handled by cy_rf.c */
    if (b == '\n' || con_len == sizeof con - 1) {
        con[con_len] = 0;
        if (con_len) logf_("cyos: %s", con);
        con_len = 0;
    }
    if (b >= 0x20 && b < 0x7f) con[con_len++] = (char)b;
}

static int64_t wall_time(void *user)
{
    (void)user;
    return (int64_t)js_wall_time();
}

static void on_speaker(void *user, float freq, float duty)
{
    (void)user;
    js_speaker(freq, duty);
}

static void on_rf(void *user, const uint8_t *pkt, size_t len, uint8_t ch)
{
    (void)user;
    if (gate) cy_gate_rf_in(gate, pkt, len, ch);
    js_rf_send(pkt, (int)len, ch);
}

static void gate_rf(void *user, const uint8_t *pkt, size_t len, uint8_t ch)
{
    (void)user;
    static uint32_t lost;
    if (!cybiko_rf_receive(&m, pkt, len, ch) && !(lost++ & 63))
        logf_("gate: radio queue full, a %u-byte packet lost (%u so far; normal while CyOS boots)", (unsigned)len,
              (unsigned)lost);
}

static void gate_log(void *user, const char *line)
{
    (void)user;
    logf_("gate: %s", line);
}

static uint32_t on_app_call(void *user, uint32_t fn, uint32_t arg)
{
    (void)user;
    if (fn == CY_APP_VERSION) return CY_APP_API;
    logf_("app call %u (%u) is not supported here", (unsigned)fn, (unsigned)arg);
    return 0;
}

/* id24: the low 24 bits of this tab's Cybiko ID (the top byte stays the
 * dump's), 0 keeps the dump's ID. gate_on: run a CyWIG for this Cybiko. */
EMSCRIPTEN_KEEPALIVE int emu_start(uint32_t id24, int gate_on, const char *home)
{
    if (started || !rom || !flash || !disk) return 0;
    install_browser();
    cy_host_t host = { .serial_tx = on_tx, .wall_time = wall_time, .speaker = on_speaker,
                       .rf_send = on_rf, .app_call = on_app_call };
    ram = calloc(1, CY_RAM_SIZE);
    if (!ram) return 0;
    cybiko_init(&m, &host, rom, flash, ram);
    cybiko_set_disk(&m, disk, disk_size);
    memcpy(ram, disk, CY_RAMDISK_SIZE);         /* in case the disk cannot be moved */
    if (id24) cybiko_set_unit_id(&m, (cybiko_unit_id(&m) & 0xff000000u) | (id24 & 0xffffffu));
    logf_("Cybiko ID %08x, RAM disk %u KB", (unsigned)cybiko_unit_id(&m), (unsigned)(disk_size >> 10));
    if (gate_on) {
        net_web_init(&net);
        cy_gate_host_t gh = { .rf_send = gate_rf, .log = gate_log };
        gate = cy_gate_create(0x4c80c0deu, &gh, &net);
        if (gate) {
            cy_gate_set_fonts(gate, flash, CY_FLASH_SIZE);
            if (home && *home) cy_gate_set_home(gate, home);
        } else {
            logf_("gate: could not start (out of memory)");
        }
    }
    started = true;
    return 1;
}

/* Runs about `states` CPU states (18.432 MHz), 1 ms at a time, with the gate
 * between. Returns the emulated milliseconds so far. */
EMSCRIPTEN_KEEPALIVE double emu_run(int32_t states)
{
    if (!started) return 0;
    const int32_t chunk = CY_CLOCK_HZ / 1000;
    while (states > 0) {
        int32_t did = cybiko_run(&m, states < chunk ? states : chunk);
        if (did <= 0) did = 1;
        states -= did;
        if (gate) cy_gate_poll(gate, (uint32_t)(m.cpu.cycles / (CY_CLOCK_HZ / 1000)));
    }
    return (double)m.cpu.cycles / (CY_CLOCK_HZ / 1000);
}

EMSCRIPTEN_KEEPALIVE void emu_key(int key, int down) { if (started) cybiko_key(&m, key, down != 0); }

/* A packet (in the scratch buffer) from another Cybiko. */
EMSCRIPTEN_KEEPALIVE int emu_rf_in(uint32_t len, int ch)
{
    if (!started) return 0;
    if (cybiko_rf_receive(&m, scratch, len, (uint8_t)ch)) return 1;
    if (!(rf_full++ & 63)) logf_("radio: queue full or bad length (%u bytes), packet lost (%u so far)",
                                 (unsigned)len, (unsigned)rf_full);
    return 0;
}

/* The screen as 8-bit luminance, 0 black; the result is lcd.version, so the
 * page can skip unchanged frames. */
EMSCRIPTEN_KEEPALIVE uint8_t *emu_lcd(void) { return lum; }
EMSCRIPTEN_KEEPALIVE uint32_t emu_lcd_render(void) { return started ? cybiko_lcd_render(&m, lum) : 0; }

EMSCRIPTEN_KEEPALIVE int emu_is_off(void) { return started && cybiko_is_off(&m); }
EMSCRIPTEN_KEEPALIVE uint32_t emu_unit_id(void) { return started ? cybiko_unit_id(&m) : 0; }

/* ---- saving ---- */

/* True (and clears the marks) when the RAM disk changed since the last call. */
EMSCRIPTEN_KEEPALIVE int emu_disk_dirty(void)
{
    bool dirty = false;
    for (size_t i = 0; i < sizeof m.disk_dirty / sizeof m.disk_dirty[0]; i++) dirty |= m.disk_dirty[i] != 0;
    memset(m.disk_dirty, 0, sizeof m.disk_dirty);
    return dirty;
}

/* The flash to save, with the dump's own Cybiko ID, or NULL when it has not
 * changed. During a CyOS update it waits until the writes stop (the caller
 * asks every few seconds). */
static uint32_t flash_writes_seen;
EMSCRIPTEN_KEEPALIVE uint8_t *emu_flash_to_save(int updating)
{
    if (!started || !m.flash.dirty) return NULL;
    if (updating) {
        bool settled = m.flash.writes == flash_writes_seen;
        flash_writes_seen = m.flash.writes;
        if (!settled) return NULL;
    }
    m.flash.dirty = false;
    uint8_t *copy = emu_scratch(CY_FLASH_SIZE);
    if (!copy) return NULL;
    memcpy(copy, flash, CY_FLASH_SIZE);
    cybiko_flash_original(&m, copy);
    return copy;
}

/* What the model met but does not cover, for the log panel. */
EMSCRIPTEN_KEEPALIVE const char *emu_stats(void)
{
    static char out[256];
    snprintf(out, sizeof out, "radio sent %u heard %u lost %u; unmapped reads %u writes %u; illegal ops %u",
             (unsigned)m.rf.sent, (unsigned)m.rf.heard, (unsigned)rf_full, (unsigned)m.unmapped_reads,
             (unsigned)m.unmapped_writes, (unsigned)m.illegal_ops);
    return out;
}
