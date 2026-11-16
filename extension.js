// Boomer for GNOME Shell
//
// A port of tsoding's Boomer (https://github.com/tsoding/boomer) to GNOME
// Shell.
//
// SPDX-License-Identifier: MIT

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_CONFIG = {
    minScale: 0.01,
    scrollSpeed: 1.5,
    dragFriction: 6.0,
    scaleFriction: 4.0,
};

const INITIAL_FL_DELTA_RADIUS = 250.0;
const FL_DELTA_RADIUS_DECELERATION = 10.0;
const VELOCITY_THRESHOLD = 15.0;
const FL_MAX_SHADOW = 0.8;
const FL_SHADOW_SPEED = 6.0;
const TIMELINE_DURATION_MS = 24 * 60 * 60 * 1000;

const PROMISIFIED_KEY = '__boomerScreenshotPromisified';
if (!globalThis[PROMISIFIED_KEY]) {
    Gio._promisify(Shell.Screenshot.prototype, 'screenshot_stage_to_content');
    globalThis[PROMISIFIED_KEY] = true;
}

function defaultConfigPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'boomer', 'config']);
}

function resolveConfigPath(path) {
    if (!path)
        return defaultConfigPath();

    if (path === '~')
        path = GLib.get_home_dir();
    else if (path.startsWith('~/'))
        path = GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);

    if (!GLib.path_is_absolute(path))
        return GLib.build_filenamev([GLib.get_home_dir(), path]);

    return path;
}

function loadFileContentsAsync(file) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(null, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                resolve(contents);
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function readConfig(path) {
    const config = {...DEFAULT_CONFIG};

    if (!path)
        return config;

    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        contents = await loadFileContentsAsync(file);
    } catch (e) {
        return null;
    }

    const text = new TextDecoder().decode(contents);
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#'))
            continue;

        const equals = line.indexOf('=');
        if (equals < 0)
            continue;

        const key = line.slice(0, equals).trim();
        const value = Number.parseFloat(line.slice(equals + 1).trim());
        if (!Number.isFinite(value))
            continue;

        switch (key) {
        case 'min_scale':
            config.minScale = value;
            break;
        case 'scroll_speed':
            config.scrollSpeed = value;
            break;
        case 'drag_friction':
            config.dragFriction = value;
            break;
        case 'scale_friction':
            config.scaleFriction = value;
            break;
        default:
            break;
        }
    }

    return config;
}

class BoomerOverlay {
    constructor({
        configPath,
        onClosed,
    }) {
        this._configPath = configPath;
        this._onClosed = onClosed;
        this._config = {...DEFAULT_CONFIG};

        this._overlay = null;
        this._image = null;
        this._flashlightArea = null;
        this._grab = null;
        this._timeline = null;
        this._closed = false;

        this._width = 0;
        this._height = 0;
        this._contentScale = 1;

        this._camera = {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            scale: 1,
            deltaScale: 0,
            pivotX: 0,
            pivotY: 0,
        };
        this._mouse = {x: 0, y: 0};
        this._previousMouse = {x: 0, y: 0};
        this._dragging = false;
        this._mirror = false;

        this._flashlight = {
            enabled: false,
            shadow: 0,
            radius: 200,
            deltaRadius: 0,
        };

        this._lastTick = 0;
        this._lastMotionTime = 0;
    }

    async open() {
        if (this._overlay || this._closed)
            return false;

        this._config = (await readConfig(this._configPath)) ?? {...DEFAULT_CONFIG};
        if (this._closed)
            return false;

        let content;
        let contentScale;
        try {
            const shooter = new Shell.Screenshot();
            [content, contentScale] = await shooter.screenshot_stage_to_content();
        } catch (e) {
            Main.notifyError(_('Boomer could not capture the screen'), e.message);
            return false;
        }

        if (this._closed) {
            content = null;
            return false;
        }

        this._contentScale = contentScale > 0 ? contentScale : 1;
        try {
            this._createOverlay(content);
        } catch (e) {
            this.close();
            throw e;
        }
        return true;
    }

    _createOverlay(content) {
        if (this._closed)
            return;

        const [width, height] = [global.stage.width, global.stage.height];
        const [pointerX, pointerY] = global.get_pointer();

        this._width = width;
        this._height = height;
        this._mouse = {x: pointerX, y: pointerY};
        this._previousMouse = {x: pointerX, y: pointerY};
        this._camera.pivotX = pointerX;
        this._camera.pivotY = pointerY;

        this._overlay = new St.Widget({
            name: 'boomer-overlay',
            reactive: true,
            can_focus: true,
            clip_to_allocation: true,
            x: 0,
            y: 0,
            width,
            height,
            style: 'background-color: #1a1a1a;',
        });

        this._image = new St.Widget({
            x: 0,
            y: 0,
            width,
            height,
            content,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        });
        this._image.set_pivot_point(0, 0);

        const filter = this._contentScale > 1
            ? Clutter.ScalingFilter.LINEAR
            : Clutter.ScalingFilter.NEAREST;
        this._image.set_content_scaling_filters(filter, filter);

        this._overlay.add_child(this._image);

        this._flashlightArea = new St.DrawingArea({
            x: 0,
            y: 0,
            width,
            height,
        });
        this._flashlightArea.connect('repaint', area => this._repaintFlashlight(area));
        this._overlay.add_child(this._flashlightArea);

        this._overlay.connect('key-press-event', (actor, event) =>
            this._onKeyPress(event));
        this._overlay.connect('button-press-event', (actor, event) =>
            this._onButtonPress(event));
        this._overlay.connect('button-release-event', (actor, event) =>
            this._onButtonRelease(event));
        this._overlay.connect('motion-event', (actor, event) =>
            this._onMotion(event));
        this._overlay.connect('scroll-event', (actor, event) =>
            this._onScroll(event));

        global.stage.add_child(this._overlay);
        this._grab = Main.pushModal(this._overlay, {
            actionMode: Shell.ActionMode.NONE,
        });

        this._applyTransform();
        this._applyFlashlightState();
        this._lastTick = GLib.get_monotonic_time() / 1_000_000;

        // Drive the physics from the stage frame clock instead of a fixed
        // 60 Hz timer, so 120/144 Hz (and higher) monitors animate at their
        // native refresh rate.
        this._timeline = new Clutter.Timeline({
            duration: TIMELINE_DURATION_MS,
            repeat_count: -1,
        });
        this._timeline.set_actor(this._overlay);
        this._timeline.connect('new-frame', () => this._tick());
        this._timeline.start();
    }

    close() {
        if (this._closed)
            return;

        this._closed = true;

        if (this._timeline) {
            this._timeline.stop();
            this._timeline = null;
        }

        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch {
                // The grab may already have been dismissed by the shell.
            }
            this._grab = null;
        }

        this._flashlightArea = null;
        if (this._image) {
            this._image.content = null;
            this._image = null;
        }

        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }

        if (this._onClosed)
            this._onClosed();
    }

    async reloadConfig() {
        const config = await readConfig(this._configPath);
        if (config)
            this._config = config;
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1_000_000;
        let dt = now - this._lastTick;
        this._lastTick = now;
        dt = Math.min(Math.max(dt, 1 / 1000), 0.1);

        let dirty = false;
        const camera = this._camera;
        const flashlight = this._flashlight;

        // zoom inertia
        if (Math.abs(camera.deltaScale) > 0.5) {
            const p0x = (camera.pivotX - this._width * 0.5) / camera.scale;
            const p0y = (camera.pivotY - this._height * 0.5) / camera.scale;

            camera.scale = Math.max(
                camera.scale + camera.deltaScale * dt,
                this._config.minScale);

            const p1x = (camera.pivotX - this._width * 0.5) / camera.scale;
            const p1y = (camera.pivotY - this._height * 0.5) / camera.scale;

            camera.x += p0x - p1x;
            camera.y += p0y - p1y;
            camera.deltaScale -= camera.deltaScale * dt * this._config.scaleFriction;
            dirty = true;
        }

        // drag inertia
        if (!this._dragging &&
            Math.hypot(camera.vx, camera.vy) > VELOCITY_THRESHOLD) {
            camera.x += camera.vx * dt;
            camera.y += camera.vy * dt;
            camera.vx -= camera.vx * dt * this._config.dragFriction;
            camera.vy -= camera.vy * dt * this._config.dragFriction;
            dirty = true;
        }

        // flashlight radius inertia
        if (Math.abs(flashlight.deltaRadius) > 1.0) {
            flashlight.radius = Math.max(
                0,
                flashlight.radius + flashlight.deltaRadius * dt);
            flashlight.deltaRadius -=
                flashlight.deltaRadius * FL_DELTA_RADIUS_DECELERATION * dt;
            dirty = true;
        }

        // flashlight fade
        if (flashlight.enabled) {
            if (flashlight.shadow < FL_MAX_SHADOW) {
                flashlight.shadow = Math.min(
                    flashlight.shadow + FL_SHADOW_SPEED * dt,
                    FL_MAX_SHADOW);
                dirty = true;
            }
        } else if (flashlight.shadow > 0) {
            flashlight.shadow = Math.max(
                flashlight.shadow - FL_SHADOW_SPEED * dt,
                0);
            dirty = true;
        }

        if (dirty) {
            this._applyTransform();
            this._flashlightArea?.queue_repaint();
        }
    }

    _applyTransform() {
        if (!this._image)
            return;

        const scale = this._camera.scale;
        const halfWidth = this._width * 0.5;
        const halfHeight = this._height * 0.5;

        const x = (this._mirror ? halfWidth * (1 + scale) : halfWidth * (1 - scale)) -
            this._camera.x * scale;
        const y = halfHeight * (1 - scale) - this._camera.y * scale;

        this._image.set_scale(this._mirror ? -scale : scale, scale);
        this._image.set_position(x, y);
    }

    _applyFlashlightState() {
        this._flashlightArea?.queue_repaint();
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();

        switch (symbol) {
        case Clutter.KEY_Escape:
        case Clutter.KEY_q:
        case Clutter.KEY_Q:
            this.close();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_0:
            this._camera.scale = 1;
            this._camera.deltaScale = 0;
            this._camera.x = 0;
            this._camera.y = 0;
            this._camera.vx = 0;
            this._camera.vy = 0;
            this._mirror = false;
            this._applyTransform();
            this._flashlightArea?.queue_repaint();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_r:
        case Clutter.KEY_R:
            this.reloadConfig();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_m:
        case Clutter.KEY_M:
            this._camera.x += this._width / this._camera.scale -
                2 * (this._mouse.x / this._camera.scale + this._camera.x);
            this._mirror = !this._mirror;
            this._applyTransform();
            this._flashlightArea?.queue_repaint();
            return Clutter.EVENT_STOP;

        case Clutter.KEY_f:
        case Clutter.KEY_F:
            this._flashlight.enabled = !this._flashlight.enabled;
            return Clutter.EVENT_STOP;

        case Clutter.KEY_equal:
        case Clutter.KEY_plus:
            this._scrollUp(state);
            return Clutter.EVENT_STOP;

        case Clutter.KEY_minus:
        case Clutter.KEY_underscore:
            this._scrollDown(state);
            return Clutter.EVENT_STOP;

        default:
            return Clutter.EVENT_STOP;
        }
    }

    _onButtonPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_STOP;

        this._previousMouse = {...this._mouse};
        this._dragging = true;
        this._lastMotionTime = GLib.get_monotonic_time() / 1_000_000;
        this._camera.vx = 0;
        this._camera.vy = 0;
        return Clutter.EVENT_STOP;
    }

    _onButtonRelease(event) {
        if (event.get_button() === Clutter.BUTTON_PRIMARY)
            this._dragging = false;
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        const [x, y] = event.get_coords();
        this._mouse = {x, y};

        if (this._dragging) {
            const scale = this._camera.scale;
            const dx = (this._previousMouse.x - x) / scale;
            const dy = (this._previousMouse.y - y) / scale;

            this._camera.x += dx;
            this._camera.y += dy;

            const now = GLib.get_monotonic_time() / 1_000_000;
            const elapsed = Math.max(now - this._lastMotionTime, 1 / 240);
            this._lastMotionTime = now;
            this._camera.vx = dx / elapsed;
            this._camera.vy = dy / elapsed;

            this._applyTransform();
        }

        this._previousMouse = {x, y};

        if (this._flashlight.shadow > 0)
            this._flashlightArea?.queue_repaint();

        return Clutter.EVENT_STOP;
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        const state = event.get_state();

        if (direction === Clutter.ScrollDirection.UP)
            this._scrollUp(state);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._scrollDown(state);

        return Clutter.EVENT_STOP;
    }

    _scrollUp(state) {
        const control = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (control && this._flashlight.enabled) {
            this._flashlight.deltaRadius += INITIAL_FL_DELTA_RADIUS;
        } else {
            this._camera.deltaScale += this._config.scrollSpeed;
            this._camera.pivotX = this._mouse.x;
            this._camera.pivotY = this._mouse.y;
        }
    }

    _scrollDown(state) {
        const control = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (control && this._flashlight.enabled) {
            this._flashlight.deltaRadius -= INITIAL_FL_DELTA_RADIUS;
        } else {
            this._camera.deltaScale -= this._config.scrollSpeed;
            this._camera.pivotX = this._mouse.x;
            this._camera.pivotY = this._mouse.y;
        }
    }

    _repaintFlashlight(area) {
        const cr = area.get_context();
        try {
            if (this._flashlight.shadow <= 0)
                return;

            if (!this._image)
                return;

            const [ix, iy] = this._image.get_position();
            const [sx, sy] = this._image.get_scale();
            const left = Math.max(0, Math.min(ix, ix + this._width * sx));
            const top = Math.max(0, Math.min(iy, iy + this._height * sy));
            const right = Math.min(this._width, Math.max(ix, ix + this._width * sx));
            const bottom = Math.min(this._height, Math.max(iy, iy + this._height * sy));

            if (right <= left || bottom <= top)
                return;

            cr.rectangle(left, top, right - left, bottom - top);
            cr.clip();

            cr.setOperator(Cairo.Operator.SOURCE);
            cr.setSourceRGBA(0, 0, 0, this._flashlight.shadow);
            cr.paint();

            const radius = this._flashlight.radius * this._camera.scale /
                this._contentScale;

            cr.setOperator(Cairo.Operator.CLEAR);
            if (radius > 0) {
                cr.arc(this._mouse.x, this._mouse.y, radius, 0, 2 * Math.PI);
                cr.fill();
            }
        } finally {
            cr.$dispose();
        }
    }
}

export default class BoomerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = null;
        this._keybindingAdded = false;
        this._sessionModeId = 0;

        Main.wm.addKeybinding(
            'toggle',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggle());
        this._keybindingAdded = true;

        this._sessionModeId = Main.sessionMode.connect('updated', () => {
            const mode = Main.sessionMode.currentMode;
            if (this._overlay &&
                (mode === 'gdm' ||
                 mode === 'unlock-dialog' ||
                 mode === 'initial-setup'))
                this._overlay.close();
        });
    }

    disable() {
        if (this._overlay) {
            this._overlay.close();
            this._overlay = null;
        }

        if (this._sessionModeId) {
            Main.sessionMode.disconnect(this._sessionModeId);
            this._sessionModeId = 0;
        }

        if (this._keybindingAdded) {
            Main.wm.removeKeybinding('toggle');
            this._keybindingAdded = false;
        }

        this._settings = null;
    }

    _toggle() {
        if (this._overlay) {
            this._overlay.close();
            return;
        }

        const configPath = resolveConfigPath(
            this._settings.get_string('config-path'));

        const overlay = new BoomerOverlay({
            configPath,
            onClosed: () => {
                if (this._overlay === overlay)
                    this._overlay = null;
            },
        });

        this._overlay = overlay;
        overlay.open().then(opened => {
            if (!opened)
                this._overlay = null;
        }).catch(e => {
            Main.notifyError(_('Boomer could not open'), e.message);
            if (this._overlay === overlay)
                this._overlay = null;
        });
    }
}
