# MicroG Lineage `boot.img` Extractor

This tool downloads and extracts the latest boot.img for your device's firmware. By default, it searches the MicroG
Lineage assets, although you can use a different server so long as its file listing is compatible with Caddy's.

It can also run the scripts required for Magisk installation after an update (this has only been tested with PL2 and Oriole devices so your mileage may vary).

Usage:

0. Make sure both Node >=14 and Docker are installed (and adb installed and enabled if you want to set up Magisk)
1. Run `pnpm install`
2. Run `pnpm start`

The tool will ask you for the exact code of your device, and will then find and download the latest copy of the firmware
from the location you provide if you don't have it already.

If the firmware contains a boot.img file, it will extract it. Otherwise, it will extract the payload.bin and use vm03's
[Payload Dumper](https://github.com/vm03/payload_dumper) tool to extract the boot.img file. It will be placed inside 
this directory. You can then use it in Magisk or something else.

If you want to pre-download the firmware, place it (without renaming the file) in the `dl` directory.
