// vim:fdm=syntax
// by:tuberry@github
//
const { Gio, Gtk, GLib, GObject, } = imports.gi;


const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
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
        super._init({ hscrollbar_policy: Gtk.PolicyType.NEVER, });

        this._buildWidgets();
        this._bindValues();
        this._buildUI();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 20, () => {
            this.get_root().default_height = 425;
            return GLib.SOURCE_REMOVE;
        }); // maybe effective, see https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4029
    }

    _buildWidgets() {
        this._field_font     = new Gtk.FontButton();
        this._field_interval = new UI.Spin(50, 500, 10);
        this._field_systray  = new UI.Check(_('Enable systray'));
        this._field_drag     = new UI.Check(_('Unlock position'));
        this._field_active   = new UI.ColourButton({ use_alpha: true, title: _('Active color') });
        this._field_outline  = new UI.ColourButton({ use_alpha: true, title: _('Outline color') });
        this._field_inactive = new UI.ColourButton({ use_alpha: true, title: _('Inactive color') });
    }

    _buildUI() {
        let grid = new UI.ListGrid();
        grid._add(this._field_systray);
        grid._add(this._field_drag);
        grid._add(new UI.Label(_('Active color')), this._field_active);
        grid._add(new UI.Label(_('Outline color')), this._field_outline);
        grid._add(new UI.Label(_('Inactive color')), this._field_inactive);
        grid._add(new UI.Label(_('Refresh interval')), this._field_interval);
        grid._add(new UI.Label(_('Font name')), this._field_font);
        this.set_child(new UI.Frame(grid));
    }

    _bindValues() {
        gsettings.bind(Fields.SYSTRAY,  this._field_systray,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DRAG,     this._field_drag,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.INTERVAL, this._field_interval, 'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.FONT,     this._field_font,     'font',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ACTIVE,   this._field_active,   'colour', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OUTLINE,  this._field_outline,  'colour', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.INACTIVE, this._field_inactive, 'colour', Gio.SettingsBindFlags.DEFAULT);
    }
});

