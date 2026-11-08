# Elgato Cam Link 4K — firmware reverse engineering

This repository documents the firmware and the update protocol of the Elgato
Cam Link 4K HDMI capture device. It also contains `cl4k-fwtool`, an independent
tool that reads, compares, and writes the firmware of the device.

The work covers the first-generation Cam Link 4K, which enumerates as USB
`0fd9:0066`. Hardware revision 3 and the MK.2 use a different chip set. See
[docs/09-other-revisions.md](docs/09-other-revisions.md) for what is known
about them.

This project is not affiliated with, or endorsed by, Elgato or Corsair.

## What the device is

The Cam Link 4K is a USB 3.0 HDMI capture device. Internally it holds these
main parts:

| Part | Device |
|---|---|
| USB controller ("MCU") | Cypress FX3, ARM926EJ-S, runs ThreadX |
| Video processor | Lattice ECP5 FPGA, `LFE5U-25F-8CABGA381` |
| HDMI receiver | ITE **IT6802**, on the internal I2C bus |
| Frame buffer | External DDR3 SDRAM |
| Storage | One 4 MiB SPI NOR flash, shared by the FX3 and the FPGA |

An HDMI receiver chip converts TMDS to a parallel video bus. The FPGA processes
that bus, two pixels per clock, with an external DDR3 frame buffer. The FX3
presents the USB interfaces and moves pixels to the host. The FX3 and the FPGA
load from the same flash.

## Main results

- The device exposes a vendor HID interface. This interface gives **direct read,
  write, and erase access to the whole SPI flash**, plus raw access to the
  internal I2C bus.
- The update path has **no signature, no encryption, and no authentication**.
  The only integrity check is a 32-bit sum that the boot ROM tests after the
  write is complete.
- The serial number of a unit is stored **inside the MCU firmware image**. A
  tool that writes a stock image without repair destroys the identity of the
  unit.
- A firmware bug leaks up to 32 bytes of uninitialized stack memory, including
  internal pointers, over USB.
- The same interface gives **live read and write access to the FPGA register
  space and to the ITE IT6802 HDMI receiver** over I2C, while the device
  streams, with no update mode and no authentication.
- The firmware images ship inside the vendor Camera Hub installer. The device
  never downloads firmware by itself.

Full detail is in [docs/07-security.md](docs/07-security.md).

## Documentation

| Document | Contents |
|---|---|
| [01-hardware.md](docs/01-hardware.md) | Chip set, buses, and how the parts connect |
| [02-usb-interfaces.md](docs/02-usb-interfaces.md) | USB descriptors, video, audio, and HID |
| [03-vendor-hid-protocol.md](docs/03-vendor-hid-protocol.md) | Complete protocol reference |
| [04-flash-layout.md](docs/04-flash-layout.md) | Map of the 4 MiB SPI flash |
| [05-firmware-images.md](docs/05-firmware-images.md) | The MCU and FPGA image formats |
| [06-firmware-update.md](docs/06-firmware-update.md) | The update procedure, step by step |
| [07-security.md](docs/07-security.md) | Security analysis |
| [08-hdmi-and-edid.md](docs/08-hdmi-and-edid.md) | HDMI behavior and the stored EDIDs |
| [09-other-revisions.md](docs/09-other-revisions.md) | Revision 3 and MK.2 |
| [10-fpga-bitstream.md](docs/10-fpga-bitstream.md) | The ECP5 bitstream, unpacked and measured |
| [11-mcu-functionality.md](docs/11-mcu-functionality.md) | All 726 MCU functions, by subsystem |
| [12-method.md](docs/12-method.md) | How these results were obtained |
| [13-i2c-devices.md](docs/13-i2c-devices.md) | The internal I2C bus, chip by chip |
| [14-netlist-recovery.md](docs/14-netlist-recovery.md) | Going further: netlist recovery, and what it costs |

## The tool

`tools/cl4k-fwtool.py` needs Python 3.8 or later and a Linux `hidraw` node. It
has no other dependencies. It sits on two modules in the same directory:
`camlink4k.py` (the HID transport) and `fwimage.py` (image parsing, serial
number repair, and flash layout). Either is usable on its own.

| Command | Action |
|---|---|
| `info` | Serial number, both firmware versions, current input format |
| `fpga` | Dump the live FPGA register space, while the device streams |
| `i2c` | Scan the internal I2C bus |
| `edid` | Read the EDID presented to the HDMI source |
| `dump` | Read the whole 4 MiB SPI flash to a file |
| `verify` | Compare the device flash against firmware files |
| `flash` | Write firmware files to the device |

```
sudo ./tools/cl4k-fwtool.py info
sudo ./tools/cl4k-fwtool.py fpga
sudo ./tools/cl4k-fwtool.py edid -o current_edid.bin
sudo ./tools/cl4k-fwtool.py dump flash.bin
sudo ./tools/cl4k-fwtool.py verify --mcu FW_Cam_Link_4K_MCU.bin
sudo ./tools/cl4k-fwtool.py flash --mcu FW_Cam_Link_4K_MCU.bin --commit
```

Only `dump`, `verify`, and `flash` stop the video stream. The rest run while
the device is in use.

`tools/ecp5-inventory.py` works offline on an unpacked bitstream. It reports the
real resource usage of an ECP5 design, and avoids the tile double counting that
makes a naive `enum:` line count report 116 block RAMs on a part that has 56.

```
ecpunpack FW_Cam_Link_4K_FPGA.bin design.config
PYTHONPATH=<trellis>/lib/trellis <python> ./tools/ecp5-inventory.py <db> design.config
```

It needs the `pytrellis` module from Project Trellis, and the database built
alongside it.

[`hal/`](hal/) holds a minimal ECP5 gate library and two driver scripts for
HAL, the netlist reverse engineering framework. They are a starting point for
the work described in [docs/14-netlist-recovery.md](docs/14-netlist-recovery.md),
not a finished flow.

The `flash` command is a dry run unless you add `--commit`. The tool reads the
serial number of the unit and repairs the image before it writes.

CAUTION: Do not remove power during a write. The device holds one firmware copy
and no backup copy. Recovery after a failed write needs the USB boot mode of
the FX3.

Firmware images are not distributed here. Take `FW_Cam_Link_4K_MCU.bin` and
`FW_Cam_Link_4K_FPGA.bin` from the vendor Camera Hub installer.

To give a normal user access to the device, install this udev rule:

```
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="0066", MODE="0660", GROUP="plugdev"
```

## License

MIT, for both the tools and the documentation. See [LICENSE](LICENSE).

Everything here is original work. The repository contains no vendor code, no
firmware images, and no extracted vendor data. It documents the behavior of a
commercial product for interoperability, repair, and security research. Product
names are the trademarks of their respective owners.
