// vim:fdm=syntax
// by:tuberry@github
//
const { Gio, Gtk, GObject, Gdk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const gsettings = ExtensionUtils.getSettings();

var Fields = {
    XPOS:     'xpos',
    YPOS:     'ypos',
    DRAG:     'draggable',
    FONT:     'font-name',
    ACTIVE:   'active-color',
    OUTLINE:  'outline-color',
    INACTIVE: 'inactive-color',
    SYSTRAY:  'enable-systray',
    INTERVAL: 'refresh-interval',
};

function buildPrefsWidget() {
    return new DesktopLyricPrefs();
}

function init() {
    ExtensionUtils.initTranslations();
}

const DesktopLyricPrefs = GObject.registerClass(
class DesktopLyricPrefs extends Gtk.ScrolledWindow {
    _init() {
        super._init({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });

        this._bulidWidget();
        this._bulidUI();
        this._bindValues();
        this._syncStatus();
        this.show_all();
    }

    _bulidWidget() {
        this._field_systray  = this._checkMaker(_('Enable systray'));
        this._field_drag     = this._checkMaker(_('Unlock position'));
        this._field_font     = new Gtk.FontButton();
        this._field_active   = new Gtk.ColorButton({ use_alpha: true, title: _('Active color') });
        this._field_outline  = new Gtk.ColorButton({ use_alpha: true, title: _('Outline color') });
        this._field_inactive = new Gtk.ColorButton({ use_alpha: true, title: _('Inactive color') });
        this._field_interval = this._spinMaker(50, 500, 10);
    }

    _bulidUI() {
        this._box = new Gtk.Box({
            margin: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });
        this.add(this._box);

        let frame = this._listFrameMaker();
        frame._add(this._field_systray);
        frame._add(this._field_drag);
        frame._add(this._labelMaker(_('Active color')), this._field_active);
        frame._add(this._labelMaker(_('Outline color')), this._field_outline);
        frame._add(this._labelMaker(_('Inactive color')), this._field_inactive);
        frame._add(this._labelMaker(_('Refresh interval (ms)')), this._field_interval);
        frame._add(this._labelMaker(_('Font name')), this._field_font);
    }

    _bindValues() {
        gsettings.bind(Fields.SYSTRAY,  this._field_systray,  'active',    Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DRAG,     this._field_drag,     'active',    Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.INTERVAL, this._field_interval, 'value',     Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.FONT,     this._field_font,     'font-name', Gio.SettingsBindFlags.DEFAULT);
    }

    _syncStatus() {
        this._field_active.set_rgba(this._getColor(Fields.ACTIVE));
        this._field_outline.set_rgba(this._getColor(Fields.OUTLINE));
        this._field_inactive.set_rgba(this._getColor(Fields.INACTIVE));
        this._field_active.connect('notify::color', widget => {
            gsettings.set_string(Fields.ACTIVE, widget.get_rgba().to_string());
        });
        this._field_outline.connect('notify::color', widget => {
            gsettings.set_string(Fields.OUTLINE, widget.get_rgba().to_string());
        });
        this._field_inactive.connect('notify::color', widget => {
            gsettings.set_string(Fields.INACTIVE, widget.get_rgba().to_string());
        });
    }

    _getColor(str) {
        let rgba = new Gdk.RGBA();
        rgba.parse(gsettings.get_string(str));

        return rgba;
    }

    _listFrameMaker() {
        let frame = new Gtk.Frame({
            label_yalign: 1,
        });
        this._box.add(frame);

        frame.grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
            row_homogeneous: false,
            column_homogeneous: false,
        });

        frame.grid._row = 0;
        frame.add(frame.grid);
        frame._add = (x, y) => {
            const hbox = new Gtk.Box();
            hbox.pack_start(x, true, true, 4);
            if(y) hbox.pack_start(y, false, false, 4);
            frame.grid.attach(hbox, 0, frame.grid._row++, 1, 1);
        }

        return frame;
    }

    _spinMaker(l, u, s) {
        return new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: l,
                upper: u,
                step_increment: s,
            }),
        });
    }

    _labelMaker(x) {
        return new Gtk.Label({
            label: x,
            hexpand: true,
            halign: Gtk.Align.START,
        });
    }

    _checkMaker(x) {
        return new Gtk.CheckButton({
            label: x,
            hexpand: true,
            halign: Gtk.Align.START,
        });
    }
});

