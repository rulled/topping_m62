# Vendor HID protocol

All commands are HID class control transfers on endpoint 0.

| Direction | Request | Value |
|---|---|---|
| Host to device | `SET_REPORT` | `0x09` |
| Device to host | `GET_REPORT` | `0x01` |

The firmware switches on the low byte of `wValue`, which is the report ID. It
ignores the report type in the high byte. A given report ID therefore behaves
the same as a Feature report and as an Input or Output report.

Two properties of this device break the HID rules. Both matter for any
implementation:

- The device **expects** the report ID as the first byte of every `SET_REPORT`
  payload.
- The device **omits** the report ID from every `GET_REPORT` response. The
  first byte returned is data.

Multi-byte numbers in command payloads are **big-endian**. Multi-byte numbers
in responses are **little-endian**.

## Command summary

| ID | Direction | Name |
|---|---|---|
| `0x01` | both | Streaming mode |
| `0x02` | to device | Flash read request |
| `0x03` | to host | Flash read data |
| `0x04` | to device | Flash page write |
| `0x05` | to device | Flash block erase |
| `0x06` | to host | Flash busy status |
| `0x09` | to device | I2C read request |
| `0x0A` | to host | I2C read data |
| `0x0B` | to device | I2C write |
| `0x12` | to device | Reset |
| `0x13` | to host | Input video format |

## `0x01` — streaming mode

Write one byte.

| Value | Effect |
|---|---|
| `1` | Stop video and audio streaming. Give the SPI bus to the FX3. |
| `0` | Return the SPI bus to the FPGA. Start streaming again. |

Read one byte to get the current state. The value is `1` when the device
streams and `0` when the FX3 holds the SPI bus.

The device must be in mode `1` before any flash command works. In mode `0` the
flash commands return errors, because the FPGA owns the bus.

The change takes about 400 ms. No replug is needed in either direction.

## `0x02` and `0x03` — read the flash

Flash reads take two transfers. First send report `0x02` with four bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Page number, big-endian |
| 2 | 2 | Byte count, big-endian |

One page is 256 bytes. The byte address is `page * 256`. The firmware limits
the count to 256 bytes.

Then read report `0x03`, which returns 258 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 256 | Data |
| 256 | 2 | Byte count returned, little-endian |

Internally the firmware sends SPI opcode `0x03` (READ) with a 24-bit address.

## `0x04` — write one flash page

Send report `0x04` with 260 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Page number, big-endian |
| 2 | 2 | Byte count, big-endian |
| 4 | 256 | Data |

The firmware sends SPI opcode `0x06` (WREN), waits for the status register,
then sends opcode `0x02` (PAGE PROGRAM) with a 24-bit address.

A page program can only clear bits. Erase the block first.

## `0x05` and `0x06` — erase a block and wait

Send report `0x05` with one byte: the block index. The firmware sends SPI
opcode `0x06` (WREN), then opcode `0xD8` with the address `index << 16`. One
block is therefore **64 KiB**. Valid indexes for a 4 MiB flash are `0x00`
to `0x3F`.

Then read report `0x06` until the returned byte is `0`. This byte is bit 0 of
the SPI status register, which is the write-in-progress bit. A measured erase
takes about 200 ms.

A read of report `0x06` returns `0xff` when the SPI transfer itself failed.
This happens when the device is not in update mode.

## `0x09` and `0x0A` — read from I2C

Send report `0x09` with three bytes:

| Offset | Field |
|---|---|
| 0 | 7-bit device address |
| 1 | Register index |
| 2 | Byte count, 32 maximum |

Then read report `0x0A`, which returns 33 bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 32 | Data |
| 32 | 1 | Byte count returned |

Device address `0x55` is special. See the next section.

## `0x0B` — write to I2C

Send report `0x0B` with 35 bytes:

| Offset | Field |
|---|---|
| 0 | 7-bit device address |
| 1 | Register index |
| 2 | Byte count |
| 3 | Data |

Device address `0x55` is special here as well.

## `0x12` — reset

Send report `0x12` with one byte. The firmware calls the FX3 reset routine.

| Value | Effect |
|---|---|
| `0` | Cold boot. The chip reloads its firmware from the flash. |
| Not `0` | Warm boot. The chip keeps the image that is already in RAM. |

Use `0` after a firmware write, so that the new image loads.

## `0x13` — input video format

Read six bytes.

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Width, little-endian |
| 2 | 2 | Height, little-endian |
| 4 | 1 | Frame rate in Hz |
| 5 | 1 | 1 when a signal is locked, 0 when there is none |

With no HDMI source connected the device reports its maximum mode,
3840 x 2160 at 30 Hz, and a signal flag of `0`.

## The internal register file at address `0x55`

Address `0x55` is not on the I2C bus. The firmware traps it and serves an
internal register file. This is how the host reads firmware versions and
device status.

Registers confirmed on hardware:

| Register | Contents |
|---|---|
| `0x00`, `0x01` | Input status block: format, frame rate, flags, two FPGA registers |
| `0x02` | Version block (see below) |
| `0x08` | Status. Reads as zero on an idle device |
| `0x0A` | Two 16-bit values and one byte |
| `0x0B`, `0x0D` | One byte, then the constants `0xAA` and `0x55` |
| `0x0C` | Five picture setting bytes |
| `0x0E` | Reads as zero on an idle device |
| `0x0F` | Four 16-bit values: output width and height, then input width and height |
| `0x10` | Two 32-bit values |
| `0x11` | Frame rate in millihertz, 32-bit (for example `29970` for 29.97 Hz) |
| `0x12` | A status block that rotates through three entries on each read |
| `0x13` and above | A register window onto a second access channel, see below |

No handler fills more than the first 16 bytes of the response. Everything past
that is uninitialized stack, and registers `0x03` to `0x07` and `0x09` have no
handler at all. See "Known defect" below.

Register `0x12` returns the last video format followed by a tag byte that
cycles through `0xA0`, `0xA1`, and `0xA2`, which is how the three entries are
told apart. One of the three reads back as all zero.

### Register `0x02` — versions

| Offset | Field |
|---|---|
| 0 | Firmware year, for example `0x14` for 2020 |
| 1 | Firmware month |
| 2 | Firmware day |
| 3 | FPGA version, a plain integer |
| 4 | FPGA register `0x90` |
| 5 | FPGA register `0x91` |

The three date bytes hold **plain binary values, not BCD**. A firmware built on
19 February 2020 returns `0x14 0x02 0x13`.

Offsets 4 and 5 are read live from the FPGA over I2C. Registers `0x90` and
`0x91` are implemented in this bitstream and both read `0x00`, so the version
block ends `43 00 00` on a stock device: FPGA design version 67, then two zeros.

The vendor manifest states the same version as a single integer. That integer
packs the same three values as `(day << 16) | (month << 8) | year`.

### The register window at `0x13` and above

Reads of register `0x13` and higher return four 16-bit values from a second
register channel, but only when an internal flag equals `1`. That flag lives at
address `0x4002B165`, starts at zero, and is written in exactly one place: the
boot-time hardware probe.

The probe chooses between two ways of reaching the HDMI receiver:

1. It looks for the receiver on I2C, at address `0x49` and then `0x48`, and
   compares four ID bytes against a constant in the firmware.
2. **If the receiver answers, the flag stays `0`** and the firmware uses I2C.
3. If the receiver does not answer, the firmware falls back to a bit-banged
   serial channel. It enables that channel, writes `0xC8B` to serial register 9,
   and reads it back. If the value matches, it sets the flag to `1`.

The window is therefore **not a debug backdoor that is switched off**. It is the
fallback register path for a board variant whose receiver is not on I2C. On a
board where the receiver answers on I2C the window is inactive by design, and no
host command can enable it. The decision is made once at boot from hardware
presence.

The window also grants nothing extra on such a board, because the same receiver
registers are already reachable through the raw I2C reports. See
[13-i2c-devices.md](13-i2c-devices.md).

### Registers used by the vendor SDK

The host SDK writes several registers that this firmware does not implement.
The firmware handler ignores them.

| Register | SDK use | Implemented here |
|---|---|---|
| `0x04` | Capture filter name | yes, write only |
| `0x05` | Clear the serial number | yes, write only |
| `0x07` | On-screen display | no |
| `0x0A`, `0x10` | HDCP | write handler present, meaning unconfirmed |
| `0x12` | EDID mode | no |
| `0x13` | Commit settings to flash | no |

The Cam Link 4K entry in the vendor device manifest does not set
`supportsEDIDMode`, so it inherits the global default of `false`. Only the Game
Capture 4K X and 4K S entries set it to `true`. This agrees with the firmware,
which has no write handler for register `0x12`.

## Known defect: stack memory disclosure

The routine that serves register reads fills a 40-byte local buffer. It clears
that buffer only for registers `0x00` and `0x01`. For every other register it
writes a few fields and then copies the requested length to the host.

A host that asks for 32 bytes therefore receives uninitialized stack memory
after the valid fields. The leaked data is stable and contains firmware
pointers. An observed response to register `0x03`, which has no handler at all,
returned 32 bytes that were entirely stack contents.

The unhandled indexes on this board are `0x03` to `0x07`, `0x09`, and every
index from `0x13` upward while the fallback window stays closed. All of them
return the buffer unchanged.

See [07-security.md](07-security.md).
