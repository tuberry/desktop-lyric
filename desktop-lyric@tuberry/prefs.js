// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.fields.Fields;
const UI = Me.imports.ui;

function buildPrefsWidget() {
    return new DesktopLyricPrefs();
}

function init() {
    ExtensionUtils.initTranslations();
}

const DesktopLyricPrefs = GObject.registerClass(
class DesktopLyricPrefs extends Gtk.ScrolledWindow {
    _init() {
        super._init({ hscrollbar_policy: Gtk.PolicyType.NEVER });

        this._buildWidgets();
        this._bindValues();
        this._buildUI();

        this.connect('realize', () => { this.get_root().default_height = 425; });
    }

    _buildWidgets() {
        this._field_font     = new Gtk.FontButton();
        this._field_interval = new UI.Spin(50, 500, 10);
        this._field_systray  = new UI.Check(_('Enable systray'));
        this._field_drag     = new UI.Check(_('Unlock position'));
        this._field_orient   = new UI.Combo([_('Horizontal'), _('Vertical')]);
        this._field_folder   = new UI.FileButton({ action: Gtk.FileChooserAction.SELECT_FOLDER });
        this._field_active   = new UI.ColourButton({ use_alpha: true, title: _('Active color'), tooltip_text: _('Active color') });
        this._field_outline  = new UI.ColourButton({ use_alpha: true, title: _('Outline color'), tooltip_text: _('Outline color') });
        this._field_inactive = new UI.ColourButton({ use_alpha: true, title: _('Inactive color'), tooltip_text: _('Inactive color') });
    }

    _buildUI() {
        let grid = new UI.ListGrid();
        grid._add(this._field_systray);
        grid._add(this._field_drag);
        grid._add(new UI.Label(_('Lyric location')), this._field_folder);
        grid._add(new UI.Label(_('Lyric orientation')), this._field_orient);
        grid._add(new UI.Label(_('Lyric colors')), new UI.Box().appends([this._field_active, this._field_inactive, this._field_outline]));
        grid._add(new UI.Label(_('Refresh interval')), this._field_interval);
        grid._add(new UI.Label(_('Font name')), this._field_font);
        this.set_child(new UI.Frame(grid));
    }

    _bindValues() {
        gsettings.bind(Fields.SYSTRAY,  this._field_systray,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DRAG,     this._field_drag,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ORIENT,   this._field_orient,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.INTERVAL, this._field_interval, 'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.FONT,     this._field_font,     'font',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ACTIVE,   this._field_active,   'colour', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OUTLINE,  this._field_outline,  'colour', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.INACTIVE, this._field_inactive, 'colour', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOCATION, this._field_folder,   'file',   Gio.SettingsBindFlags.DEFAULT);
    }
});

