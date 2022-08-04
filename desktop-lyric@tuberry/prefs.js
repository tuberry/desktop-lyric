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
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_systray  = new Gtk.CheckButton();
        this._field_drag     = new Gtk.CheckButton();
        this._field_interval = new UI.Spin(50, 500, 10);
        this._field_active   = new UI.Color(_('Active color'));
        this._field_outline  = new UI.Color(_('Outline color'));
        this._field_inactive = new UI.Color(_('Inactive color'));
        this._field_orient   = new UI.Drop(_('Horizontal'), _('Vertical'));
        this._field_font     = new Gtk.FontButton({ valign: Gtk.Align.CENTER });
        this._field_folder   = new UI.File({ action: Gtk.FileChooserAction.SELECT_FOLDER });
    }

    _buildUI() {
        [
            [this._field_systray, [_('Enable systray')]],
            [this._field_drag, [_('Unlock position')]],
            [[_('Lyric orientation')], this._field_orient],
            [[_('Lyric location')], this._field_folder],
            [[_('Lyric colors')], this._field_active, this._field_inactive, this._field_outline],
            [[_('Refresh interval')], this._field_interval],
            [[_('Font name')], this._field_font],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }

    _bindValues() {
        [
            [Fields.SYSTRAY,  this._field_systray,  'active'],
            [Fields.DRAG,     this._field_drag,     'active'],
            [Fields.ORIENT,   this._field_orient,   'selected'],
            [Fields.INTERVAL, this._field_interval, 'value'],
            [Fields.FONT,     this._field_font,     'font'],
            [Fields.ACTIVE,   this._field_active,   'colour'],
            [Fields.OUTLINE,  this._field_outline,  'colour'],
            [Fields.INACTIVE, this._field_inactive, 'colour'],
            [Fields.LOCATION, this._field_folder,   'file'],
        ].forEach(xs => gsettings.bind(...xs, Gio.SettingsBindFlags.DEFAULT));
    }
}

