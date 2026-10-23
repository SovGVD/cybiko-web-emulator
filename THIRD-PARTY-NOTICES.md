# Third-party notices

The emulator in `web/emu.wasm` is built from the C in
[Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32) and
[cybiko-browser](https://github.com/SovGVD/cybiko-browser). Their own notices
([Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32/blob/main/docs/third-party-notices.md))
cover everything; the parts that end up in the page are repeated here.

## MAME

The Cybiko Xtreme emulation (Dragonfruit's `src/components/h8s` and `src/components/cybiko`)
is original C, but it would not exist without [MAME](https://www.mamedev.org/)
and the people who worked out this hardware there. Its hardware description
follows:

- the Cybiko driver (`src/mame/cybiko`), the HD66421 LCD controller and the
  PCF8593 clock, by Tim Schuerewegen;
- the imgtool `cybikoxt` module (`src/tools/imgtool/modules/cybikoxt.cpp`),
  by Tim Schuerewegen: the RAM disk page layout and page checksum in
  Dragonfruit's `cy_disk.c`;
- the H8 instruction table and on-chip peripheral models (`src/devices/cpu/h8`),
  by Olivier Galibert and hap;
- the Intel/AMD flash model, by Aaron Giles.

Portions derived from MAME: Copyright (c) Tim Schuerewegen, Olivier Galibert,
hap, Aaron Giles and the MAME contributors. These MAME files are under the
BSD 3-Clause license:

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```


## TJpgDec

cybiko-browser's gate decodes JPEG pictures with TJpgDec R0.03, Tiny JPEG
Decompressor by ChaN, (C) 2021, http://elm-chan.org/fsw/tjpgd/. Its license
allows use, modification and redistribution in source and binary form
without restriction, as long as the copyright notice stays with the source.
