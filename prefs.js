// SPDX-License-Identifier: MIT

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODIFIER_MASK =
    Gdk.ModifierType.SHIFT_MASK |
    Gdk.ModifierType.CONTROL_MASK |
    Gdk.ModifierType.ALT_MASK |
    Gdk.ModifierType.SUPER_MASK;

function isModifierKey(keyval) {
    const name = Gdk.keyval_name(keyval) ?? '';
    return /^(Shift|Control|Alt|Meta|Super|Hyper|Caps|Num|ISO)_(L|R|Lock)$/.test(name);
}

class ShortcutDialog {
    constructor(parent, currentAccelerator, onAccelerator) {
        this._onAccelerator = onAccelerator;

        this._dialog = new Gtk.Dialog({
            transient_for: parent,
            modal: true,
            title: _('Set Shortcut'),
            use_header_bar: true,
        });
        this._dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        this._dialog.set_default_size(380, -1);

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });

        this._prompt = new Gtk.Label({
            label: _('Press the key combination you want to use.'),
            wrap: true,
        });
        box.append(this._prompt);

        this._preview = new Gtk.ShortcutLabel({
            disabled_text: _('Waiting for input…'),
            accelerator: currentAccelerator ?? '',
            halign: Gtk.Align.CENTER,
        });
        box.append(this._preview);

        this._dialog.set_child(box);

        const controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                this._dialog.close();
                return Gdk.EVENT_STOP;
            }

            if (isModifierKey(keyval))
                return Gdk.EVENT_STOP;

            const modifiers = state & Gtk.accelerator_get_default_mod_mask();
            if ((modifiers & MODIFIER_MASK) === 0) {
                this._prompt.label =
                    _('The shortcut must include Shift, Ctrl, Alt or Super.');
                return Gdk.EVENT_STOP;
            }

            const accelerator = Gtk.accelerator_name_with_keycode(
                this._dialog.get_display(),
                keyval,
                keycode,
                modifiers);

            if (!accelerator)
                return Gdk.EVENT_STOP;

            this._preview.set_accelerator(accelerator);
            this._onAccelerator(accelerator);
            this._dialog.close();
            return Gdk.EVENT_STOP;
        });
        this._dialog.add_controller(controller);
    }

    present() {
        this._dialog.present();
    }
}

export default class BoomerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Boomer'),
            icon_name: 'zoom-fit-best-symbolic',
        });
        window.add(page);

        const generalGroup = new Adw.PreferencesGroup({
            title: _('General'),
        });
        page.add(generalGroup);

        const shortcutRow = new Adw.ActionRow({
            title: _('Toggle Boomer'),
            subtitle: _('Freeze the screen and open the zoomer'),
        });

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            accelerator: '',
            valign: Gtk.Align.CENTER,
        });
        const shortcutButton = new Gtk.Button({
            child: shortcutLabel,
            valign: Gtk.Align.CENTER,
        });
        shortcutButton.set_tooltip_text(_('Change shortcut'));
        shortcutButton.connect('clicked', () => {
            const current = settings.get_strv('toggle')[0] ?? '';
            new ShortcutDialog(window, current, accelerator => {
                settings.set_strv('toggle', [accelerator]);
            }).present();
        });

        const resetButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
        });
        resetButton.set_tooltip_text(_('Reset to the default shortcut'));
        resetButton.connect('clicked', () => settings.reset('toggle'));

        shortcutRow.add_suffix(shortcutButton);
        shortcutRow.add_suffix(resetButton);
        shortcutRow.activatable_widget = shortcutButton;
        generalGroup.add(shortcutRow);

        const syncShortcutLabel = () => {
            shortcutLabel.set_accelerator(settings.get_strv('toggle')[0] ?? '');
        };
        syncShortcutLabel();
        const shortcutChangedId = settings.connect('changed::toggle', syncShortcutLabel);

        const configGroup = new Adw.PreferencesGroup({
            title: _('Configuration'),
            description: _('Boomer reads the same configuration file as the ' +
                'original application. Leave the path empty to use ' +
                '~/.config/boomer/config.'),
        });
        page.add(configGroup);

        const configRow = new Adw.EntryRow({
            title: _('Config file'),
        });
        configRow.text = settings.get_string('config-path');
        configRow.connect('changed', () => {
            settings.set_string('config-path', configRow.text.trim());
        });
        configGroup.add(configRow);

        const controlsGroup = new Adw.PreferencesGroup({
            title: _('Controls'),
        });
        page.add(controlsGroup);

        const controls = [
            [_('Pan'), _('Drag with the left mouse button')],
            [_('Zoom'), _('Scroll wheel or = / -')],
            [_('Flashlight'), _('F toggles the flashlight')],
            [_('Flashlight radius'), _('Ctrl + scroll wheel while the flashlight is on')],
            [_('Mirror'), _('M mirrors the image around the pointer')],
            [_('Reload config'), _('R')],
            [_('Reset'), _('0 resets position, zoom and mirroring')],
            [_('Close'), _('Q or Esc')],
        ];

        for (const [title, subtitle] of controls) {
            controlsGroup.add(new Adw.ActionRow({
                title,
                subtitle,
                activatable: false,
            }));
        }

        window.connect('close-request', () => {
            settings.disconnect(shortcutChangedId);
            return false;
        });
    }
}
