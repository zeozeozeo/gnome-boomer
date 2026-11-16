# Boomer for GNOME Shell

A GNOME Shell port of [tsoding's Boomer](https://github.com/tsoding/boomer),
the zoomer for boomers.

Press <kbd>Super</kbd>+<kbd>Z</kbd> to freeze the screen and open a fullscreen
zoomer over the whole desktop. Pan, zoom, mirror and shine a flashlight on
what is underneath, then press <kbd>Esc</kbd> to go back to your desktop.

The aim of this port is to behave like the original application, not to be a
new magnification tool:

- the screen is captured **once** when the overlay opens (the default Boomer
  mode, without the experimental `-d:live` flag)
- panning uses the same velocity and friction model
- zooming uses the same pivot adjustment and friction
- the flashlight fades in and out and is resized in the same way
- mirroring flips the image around the pointer
- animation is driven by the compositor's frame clock, so 120/144 Hz displays
  run at their native refresh rate instead of a fixed 60 Hz
- the same `~/.config/boomer/config` file and the same configuration keys are
  used

## Requirements

- GNOME Shell 45 or newer (Wayland or X11)

## Install

### From the GNOME Extensions website

Install it from [extensions.gnome.org](https://extensions.gnome.org/).

### From this repository

```console
$ cd gnome-extension
$ make install
$ gnome-extensions enable boomer@digital
```

On Wayland, log out and back in if the shell does not pick up a newly installed
extension immediately. On X11 you can restart the shell with
<kbd>Alt</kbd>+<kbd>F2</kbd>, then `r`.

### Development

```console
$ cd gnome-extension
$ make schemas          # compile the GSettings schema
$ make pack             # create boomer@digital.shell-extension.zip
```

`make install` copies the extension into
`~/.local/share/gnome-shell/extensions/boomer@digital`.

## Controls

| Control | Action |
| --- | --- |
| <kbd>Super</kbd>+<kbd>Z</kbd> | Open the zoomer (changeable in preferences) |
| <kbd>0</kbd> | Reset position, zoom and mirroring |
| <kbd>Q</kbd> or <kbd>Esc</kbd> | Close the zoomer |
| <kbd>R</kbd> | Reload `config` |
| <kbd>M</kbd> | Mirror the image around the pointer |
| <kbd>F</kbd> | Toggle the flashlight |
| Drag with the left mouse button | Pan |
| Scroll wheel or <kbd>=</kbd> / <kbd>-</kbd> | Zoom in / out |
| <kbd>Ctrl</kbd> + scroll wheel | Change the flashlight radius (when the flashlight is on) |

## Configuration

Boomer for GNOME Shell reads the same file as the original application:

```
$XDG_CONFIG_HOME/boomer/config
```

which is usually `~/.config/boomer/config`. The format is the same:

```
min_scale = 0.01
scroll_speed = 1.5
drag_friction = 6.0
scale_friction = 4.0
```

Create one with the original application:

```console
$ boomer --new-config
```

You can also point the extension at a different file from its preferences
(**Config file**). Press <kbd>R</kbd> after editing the file to reload it while
the zoomer is open.

## Differences from the original

The default behavior of Boomer is reproduced. These optional/experimental
parts are intentionally not included:

- `-d:live` / `-d:mitshm` live screenshot updates (Boomer's static screenshot
  mode is the default and the one this extension implements)
- `-d:select` window tracking

## License and credits

MIT, the same license as the original Boomer. The behavior, camera model and
configuration format are ported from
[tsoding/boomer](https://github.com/tsoding/boomer), Copyright (c) 2019 Tsoding.
