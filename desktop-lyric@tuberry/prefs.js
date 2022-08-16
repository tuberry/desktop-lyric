// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const gsettings = ExtensionUtils.getSettings();
const { Fields } = Me.imports.fields;
const UI = Me.imports.ui;

function buildPrefsWidget() {
    return new DesktopLyricPrefs();
}

function init() {
    ExtensionUtils.initTranslations();
}

class DesktopLyricPrefs extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this._buildWidgets();
        this._buildUI();
    }

    _buildWidgets() {
        this._field = {
            SYSTRAY:  ['active',   new Gtk.CheckButton()],
            DRAG:     ['active',   new Gtk.CheckButton()],
            INTERVAL: ['value',    new UI.Spin(50, 500, 10)],
            ACTIVE:   ['colour',   new UI.Color(_('Active color'))],
            OUTLINE:  ['colour',   new UI.Color(_('Outline color'))],
            INACTIVE: ['colour',   new UI.Color(_('Inactive color'))],
            ORIENT:   ['selected', new UI.Drop([_('Horizontal'), _('Vertical')])],
            FONT:     ['font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            LOCATION: ['file',     new UI.File({ action: Gtk.FileChooserAction.SELECT_FOLDER })],
        };
        Object.entries(this._field).forEach(([x, [y, z]]) => gsettings.bind(Fields[x], z, y, Gio.SettingsBindFlags.DEFAULT));
    }

    _buildUI() {
        [
            [this._field.SYSTRAY[1],   [_('Enable systray')]],
            [this._field.DRAG[1],      [_('Unlock position')]],
            [[_('Lyric orientation')], this._field.ORIENT[1]],
            [[_('Lyric location')],    this._field.LOCATION[1]],
            [[_('Lyric colors')],      this._field.ACTIVE[1], this._field.INACTIVE[1], this._field.OUTLINE[1]],
            [[_('Refresh interval')],  this._field.INTERVAL[1]],
            [[_('Font name')],         this._field.FONT[1]],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
