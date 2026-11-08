# topping-m62

Notes and tools for controlling a **Topping M62** USB audio
interface from Linux.

The M62's analogue mic gains, output volumes, mutes, source
selectors, three-mix mixer matrix, loopback routing and EQ are not
reachable through the USB Audio Class. They live behind a vendor
protocol on the card's HID interface, spoken by Topping's own M
Control Center, which has no Linux build. This repository is what
was learned by capturing that channel and writing to it.

**[PROTOCOL.md](PROTOCOL.md) is the point of this repository.**
The tools can be rewritten in an afternoon; the protocol took a
month of captures. Every claim in it is marked as verified on the
card, decoded from captures, or guessed, because in six months
nobody will remember which was which.

## What this is not

* **Not a driver.** A `sound/usb` mixer quirk exposing the input
  gains, the output volumes and the two output source selectors as
  ordinary ALSA controls is a separate matter and belongs upstream,
  not here.
* **Not an equalizer.** Per-device correction for PipeWire lives in
  [per-device-eq](https://github.com/NTMan/PerDeviceEQ). The M62
  is one of the interfaces it measures through, and that is the
  whole overlap.
* **Not M Control Center.** Nothing here configures the card the
  way the vendor application does. It reads the wire and writes
  single values.

## Contents

| Path | What it is |
| --- | --- |
| `PROTOCOL.md` | the frame, the address map, the value encodings, and what the card refuses to tell you |
| `tools/m62-listen.py` | subscribes within milliseconds of the card appearing and decodes every frame it sends |

`m62-listen.py` has to start **before** the card is plugged in.
The M62 announces its state once, shortly after enumeration, and
only to whoever has already subscribed; a command typed by hand is
seconds late and sees nothing. That single fact is the reason the
tool exists in this shape.

## Where the boundary with the kernel runs

This matters before anyone builds on the protocol, so it is stated
here as well as in the document.

The mixer quirk claims the card's HID interface for
`snd-usb-audio` and adds the card to `hid_ignore_list`. That means
**no `hidraw` node**, which means the vendor protocol is not
reachable from userspace on a kernel carrying the quirk.

So the two do not coexist today. A program built on this document
runs on a kernel without the quirk, or waits for a kernel-side
channel to the same protocol. The trade-off was weighed and
accepted when the road was chosen; it is written down so nobody
rediscovers it as a bug.

What the quirk covers, and a userspace program should therefore
leave alone: input gains, output volumes, and the two output
source selectors.

What remains reachable only through the vendor protocol: the mixer
matrix, mutes, loopback source routing, input power (48 V and
plug-in bias), the EQ blocks, and the save-to-device command.

## Two warnings worth reading before experimenting

**Never write to interface 3.** It is Application Specific / DFU,
presenting as "Topping DFU". A stray write there can brick the
card. The control channel is interface 4.

**The card has two memories and a battery.** A write changes the
live state only; the card's own storage is committed separately.
And because the M62 is battery powered, unplugging USB is not a
power cycle -- any persistence experiment that assumes it is will
produce results that look random.

## Licence

The tools are GPL-3.0-or-later; see [LICENSE](LICENSE).

`PROTOCOL.md` is placed in the public domain (CC0-1.0)
deliberately and separately, because the likeliest reader is
someone carrying a table out of it into a kernel patch, and the
kernel is GPL-2.0-only. Copy any of it, with or without
attribution.

## Hardware this describes

Topping M62, USB `152a:875c`, firmware V87.05.45.48.27, hardware
V1.00. Other firmware revisions are untested; the identification
block at target `0x12` reports both, so anything built on this can
check rather than assume.

