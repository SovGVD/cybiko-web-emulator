# Third-party notices

The emulator in `web/emu.wasm` is built from the C in
[Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32) and
[cybiko-browser](https://github.com/SovGVD/cybiko-browser). Their own notices
([Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32/blob/main/docs/third-party-notices.md))
cover everything; the parts that end up in the page are repeated here.

## MAME

The Cybiko Xtreme and Classic emulation (Dragonfruit's `src/components/h8s` and `src/components/cybiko`)
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
- the Intel/AMD flash model, by Aaron Giles;
- for the Cybiko Classic, the `cybikov1` machine, the H8S/2245 family
  (`h8s2245`) and the AT45DBxx DataFlash (`at45dbxx`), by Tim Schuerewegen,
  Olivier Galibert and hap.

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

## ReBiko

The Cybiko Classic emulation (Dragonfruit's `cy_classic.c` and the
`m->classic` parts of `src/components/cybiko`) follows Dan Berkowitz's
[ReBiko](https://github.com/RetroCodeRamen/rebiko), a Cybiko Classic and
Xtreme emulator for the LilyGO T-Deck and the desktop. ReBiko worked out the
Classic's memory map, the AT45 DataFlash on SCI1, the radio co-processor's
Classic framing, the battery values CyOS 1.2.46 wants, the empty-block format
of the flash, the idea of emulating a 1 MB AT45DB081 for more room, and where
CyOS 1.2.46 keeps the Cybiko ID in RAM. Dragonfruit's code is written
separately, but those details come from ReBiko, under the MIT license:

```text
MIT License

Copyright (c) 2026 Dan Berkowitz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## TJpgDec

cybiko-browser's gate decodes JPEG pictures with TJpgDec R0.03, Tiny JPEG
Decompressor by ChaN, (C) 2021, http://elm-chan.org/fsw/tjpgd/. Its license
allows use, modification and redistribution in source and binary form
without restriction, as long as the copyright notice stays with the source.
