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
- the same `~/.config/boomer/config` file and the same configuration keys are
  used

## Requirements

- GNOME Shell 45 or newer (Wayland or X11)
- No extra runtime dependencies

## Install

### From the GNOME Extensions website

Once the extension is published, install it from
[extensions.gnome.org](https://extensions.gnome.org/).

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

As in the original application, the flashlight radius is the only thing changed
by <kbd>Ctrl</kbd>+scroll while the flashlight is enabled; otherwise Ctrl+scroll
still zooms.

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
the zoomer is open. Unknown keys and non-numeric values are ignored and logged,
so a typo cannot prevent the extension from opening.

## Differences from the original

The default behavior of Boomer is reproduced. These optional/experimental
parts are intentionally not included:

- `-d:live` / `-d:mitshm` live screenshot updates (Boomer's static screenshot
  mode is the default and the one this extension implements)
- `-d:select` window tracking
- `-d:developer` shader hot reloading (there are no GLSL shaders to reload in
  this implementation)

The OpenGL shader and X11 event loop are replaced by Clutter actors, a Cairo
overlay for the flashlight, and one timer driving the same physics. On regular
(non-HiDPI) screens the captured image uses nearest-neighbor sampling, like
Boomer's `GL_NEAREST`. On HiDPI screens it uses linear filtering, because the
capture is larger than the logical stage and nearest sampling would discard
half of the pixels.

## Publishing on extensions.gnome.org

1. Change the UUID in `metadata.json` if you want to publish under your own
   namespace. The UUID in this repository is `boomer@digital`.
2. Bump `"version"` in `metadata.json` for every upload.
3. Run `make pack` to create `boomer@digital.shell-extension.zip`.
4. Upload the zip at <https://extensions.gnome.org/upload/> and fill in the
   description, screenshots, and the source code URL. You can also add a
   `"url"` field pointing to your repository to `metadata.json`.
5. Test on each GNOME Shell version listed in `metadata.json` before claiming
   support for it.

The `version` field and the `shell-version` list are the two values the
extensions website uses to decide what to offer to users.

## License and credits

MIT, the same license as the original Boomer. The behavior, camera model and
configuration format are ported from
[tsoding/boomer](https://github.com/tsoding/boomer), Copyright (c) 2019 Tsoding.
