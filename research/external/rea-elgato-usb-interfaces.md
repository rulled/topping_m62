# USB interfaces

## Identity

| Field | Value |
|---|---|
| Vendor ID | `0x0fd9` (Elgato Systems GmbH) |
| Product ID | `0x0066` on a USB 3.0 port |
| Product ID | `0x0067` on a USB 2.0 port |
| Device class | `0xEF` / `0x02` / `0x01` (interface association) |
| Manufacturer | `Elgato` |
| Product | `Cam Link 4K` |
| Serial number | 13 characters, unique for each unit |

The product ID changes with the port speed. The device reports the same serial
number in both states.

## Interface map

The device presents five interfaces in three functions.

| Interface | Class | Function |
|---|---|---|
| 0 | Video Control | UVC control, interrupt endpoint `0x82` |
| 1 | Video Streaming | UVC video, bulk endpoint `0x83` |
| 2 | HID | Vendor control interface, interrupt endpoint `0x86` |
| 3 | Audio Control | UAC control |
| 4 | Audio Streaming | UAC audio, isochronous endpoint `0x81` |

The vendor HID interface is interface 2. This number is different on hardware
revision 3, which uses interface 7.

## Video

The video interface reports UVC 1.10. It carries three uncompressed formats.
All three declare the same frame size.

| Format index | GUID | Format |
|---|---|---|
| 1 | `3231564e-...` | NV12 |
| 2 | `3231564e-...` | NV12 |
| 3 | `30323449-...` | I420 |

| Field | Value |
|---|---|
| Frame size | 3840 x 2160 |
| Frame interval | 333667 (30.00 Hz) |
| Bits per pixel | 12 |
| Color space | BT.709 / sRGB |
| Maximum bit rate | 2,985,984,000 bit/s |

The video endpoint is **bulk**, not isochronous. It uses a burst of 16 packets
of 1024 bytes. Bulk transfer explains why the device needs a port that is not
shared with other high-rate devices.

The processing unit reports four controls: brightness, contrast, hue, and
saturation.

The descriptors declare only the 4K mode. The device negotiates lower modes
through the standard UVC probe and commit requests. The firmware logs these as
`Set CY_FX_USB_UVC_SET_CUR_REQ probe` and `... commit`.

## Audio

The audio interface reports UAC 1.00. It has one input terminal of type
`0x0602` (digital audio interface), which is the audio that arrives over HDMI.

| Field | Value |
|---|---|
| Channels | 2 (front left, front right) |
| Sample rate | 48000 Hz |
| Sample size | 16 bit |
| Endpoint | Isochronous asynchronous, 192 bytes per interval |

The vendor application applies an audio latency of 20 ms for this device.

## The vendor HID interface

Interface 2 carries a 207-byte report descriptor. The descriptor declares one
application collection on vendor usage page `0xFF00`. It contains 19 reports,
all of them arrays of 8-bit items.

| Report ID | Type | Payload size |
|---|---|---|
| `0x01` | Feature | 1 |
| `0x02` | Output | 4 |
| `0x03` | Input | 258 |
| `0x04` | Output | 260 |
| `0x05` | Output | 1 |
| `0x06` | Input | 1 |
| `0x07` | Feature | 1 |
| `0x08` | Feature | 1 |
| `0x09` | Output | 3 |
| `0x0A` | Input | 33 |
| `0x0B` | Output | 35 |
| `0x0C` | Output | 1 |
| `0x0D` | Input | 1 |
| `0x0E` | Output | 2 |
| `0x0F` | Output | 3 |
| `0x10` | Input | 32 |
| `0x11` | Output | 35 |
| `0x12` | Output | 1 |
| `0x13` | Input | 1 |

The firmware implements only 11 of these 19 reports. Reports `0x07`, `0x08`,
`0x0C`, `0x0D`, `0x0E`, `0x0F`, `0x10`, and `0x11` return a stall. The report
descriptor is shared across a product family, so it declares more than this
model uses.

Report `0x13` is a second mismatch. The descriptor declares one byte, but the
firmware returns six.

The device has **no interrupt OUT endpoint**. All host-to-device traffic goes
through `SET_REPORT` on endpoint 0.
