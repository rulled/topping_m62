# M-VAVE ANN BlackBox reverse engineering

Independent, community-oriented documentation and read-only tooling for the
M-VAVE ANN BlackBox. This project investigates the device firmware, runtime
layout, USB Audio implementation, BLE/M-EFCS protocol, OTA behavior, and
audio/DSP architecture using reproducible evidence.

The repository is not limited to one modification or firmware version. It is
intended to grow as new firmware, protocol findings, hardware observations,
and independently reproduced results become available.

> [!WARNING]
> This project does **not** ship M-VAVE firmware, decrypted images, APKs, or
> modified firmware. The tools inspect files you already obtained lawfully.
> No firmware image produced during the investigation is recommended for
> flashing.

> [!NOTE]
> This is a research archive maintained on a best-effort basis. Individual
> technical support, device troubleshooting, and response-time guarantees are
> not provided. Findings may be corrected as the analysis progresses.

## Start here

- [Research status](docs/research-status.md): current coverage, confidence, and
  open questions across the project.
- [V20 address map](docs/address-map-v20.md): image landmarks and application to
  runtime address translation.
- [Complete V20 structural map](docs/firmware-map-v20.md): whole-image decoder
  coverage, generated call map, strings, pointers, and remaining semantic work.
- [`audio_dev` and runtime lists](docs/audio-dev-and-lists.md): device objects,
  handles, callbacks, and intrusive-list lifecycle.
- [DAC client census](docs/research/dac-client-census-v20.md): complete V20
  backend census, registration templates, callbacks, and current identity
  limit.
- [DAC handle propagation](docs/research/dac-handle-propagation-v20.md): where
  returned handles survive and whether stock M-EFCS can observe them.
- [USB Audio](docs/usb-audio.md): playback/capture endpoints and formats.
- [BLE/M-EFCS protocol](docs/mefcs-protocol.md): observed framing, commands,
  transports, and access limits.
- [OTA observations](docs/ota-observations.md): updater behavior and safety
  boundaries.
- [MaskROM/UBOOT1.00 entry](docs/research/maskrom-entry-v20.md): retained boot
  marker, reset paths, callers, and stock reachability.
- [Methodology](docs/methodology.md): evidence levels and reproducible workflow.
- [Selective local-monitoring research](docs/research/local-monitoring.md): one
  active audio-routing investigation and its rejected approaches.

## Current technical baseline

- V20 application offsets map to runtime addresses with
  `runtime = app_offset + 0x02000120`.
- The V20 image has a reproducible whole-image structural map: 222,490 decoded
  instructions cover 94.2426% of 655,712 bytes, with 2,169 candidate function
  entries and 12,152 resolved direct call sites.
- The `audio_dev` string is at application offset `0x5BC1A` (runtime
  `0x0205BD3A`). Its immediate load begins at `0x43328`; `0x4332A` lies inside
  that six-byte instruction and is not an instruction boundary.
- USB Audio endpoint `0x02 OUT` carries host-to-device playback and endpoint
  `0x83 IN` carries device-to-host capture. Both descriptors specify stereo,
  24-bit, 44.1 kHz audio.
- Task entries at application offsets `0x40530` and `0x41EC6` are associated
  with `audio_encoder` and `audio_server`, respectively. The former uses
  intrusive `LIST_A`; the DAC renderer uses a separate per-client list.
- The DAC renderer at `0x4A698` uses the client list at `0x01C0DC3C`. Two
  registration templates were recovered at `0x409DA` and `0x418E0`, but V20
  does not statically bind their runtime instances to USB playback and local
  DSP as two distinct identities.
- DAC-open handles remain in their heap-owner fields and owner lists. No copy
  into a stock-readable `DEV`/M-EFCS family, UAC speaker object, or fixed
  identity field was found.
- V20 `DEV` reads expose specific bounded families, including a patch snapshot
  and a one-byte Computer Loopback state. They do not expose arbitrary SRAM.
- BLE and USB expose related M-EFCS messaging through different transports;
  observed commands do not yet provide a complete control map.
- V20 contains an exact retained-marker writer equivalent to
  `nvram_set_boot_state()` at `0x93932`, but it has no static caller or pointer
  reference. The reachable USB-HID OTA reset follows a different normal-update
  path; no stock software entry to UBOOT1.00 was found.

These statements summarize the present evidence, not a finished semantic map
of the firmware. The linked documents separate verified results from strong
inferences, hypotheses, and rejected interpretations.

## Research areas

| Area | Current coverage | Status |
| --- | --- | --- |
| Firmware V20 | Whole-image structural pass, calls, strings, pointers, gaps, reviewed landmarks | Structurally mapped; semantic naming active |
| Runtime architecture | Task identities, objects, DAC client census, handle propagation, bounded DEV reads | Structurally reconstructed; two runtime identities unresolved |
| USB Audio | Endpoint direction, descriptors, formats, host observations | Core facts verified |
| BLE/M-EFCS | Framing, transport behavior, selected commands and memory spaces | Partial protocol map |
| OTA/updater | Package behavior, retained boot marker, normal OTA reset path | Stock UBOOT1.00 route not found; not recovery-safe |
| Audio/DSP routing | Output/capture structures and lifecycle candidates | Active research |
| Selective local monitoring | Separate DSP-local contribution while retaining both USB paths | Open question |
| Tooling | Read-only inspection and synthetic regression tests | Available |

Selective local monitoring is one application of the broader architecture
research. Its detailed target, evidence matrix, and current next steps live in
the dedicated [research note](docs/research/local-monitoring.md), rather than
defining the scope of the repository.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | Architecture, protocol notes, research threads, and status |
| `analysis/v20/` | Reviewed seeds and generated non-byte-bearing structural map |
| `tools/` | Read-only firmware inspection utilities |
| `tests/` | Synthetic tests containing no vendor data |

## Reproduce

Run from the repository root:

```bash
python3 tools/blackbox_inspect.py path/to/BlackBox_app_decrypted.bin
python3 tools/blackbox_inspect.py --json path/to/BlackBox_app_decrypted.bin
python3 -m unittest discover -s tests -v
python3 tools/check_repo.py
```

The inspector never writes to the input image. It reports hashes, known ASCII
landmarks, USB Audio endpoint descriptors, and application/runtime address
translations.

The full mapping pipeline and the required local-only PI32v2 decoder workflow
are documented in [`analysis/v20/README.md`](analysis/v20/README.md).

## Evidence policy

Technical statements use four confidence levels:

- **Verified**: reproduced from bytes, logs, or controlled device tests.
- **Strong inference**: multiple observations agree, but identity or semantics
  remain incomplete.
- **Hypothesis**: a useful lead requiring a discriminating test.
- **Rejected**: contradicted, unsafe, or too broad for the intended operation.

No claim is made that this project is affiliated with or endorsed by M-VAVE,
JieLi, Sinco Audio, or their partners. Product names are used only for
identification and interoperability research.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Do not submit copyrighted firmware,
APKs, device serial numbers, private logs, credentials, or instructions to
flash unreviewed images.

## License

Original documentation and tools in this repository are released under the
MIT License. This does not grant rights to third-party firmware, applications,
trademarks, or other vendor material.
