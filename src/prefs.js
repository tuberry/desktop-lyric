// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const { Fields, Block } = Me.imports.fields;
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
        this._blk = new Block({
            drag:   [Fields.DRAG,     'active',   new Gtk.CheckButton()],
            span:   [Fields.INTERVAL, 'value',    new UI.Spin(50, 500, 10)],
            acolor: [Fields.ACTIVE,   'colour',   new UI.Color(_('Active color'))],
            ocolor: [Fields.OUTLINE,  'colour',   new UI.Color(_('Outline color'))],
            icolor: [Fields.INACTIVE, 'colour',   new UI.Color(_('Inactive color'))],
            orient: [Fields.ORIENT,   'selected', new UI.Drop([_('Horizontal'), _('Vertical')])],
            font:   [Fields.FONT,     'font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            index:  [Fields.INDEX,    'selected', new UI.Drop([_('Left'), _('Center'), _('Right')])],
            path:   [Fields.LOCATION, 'file',     new UI.File({ action: Gtk.FileChooserAction.SELECT_FOLDER })],
        });
    }

    _buildUI() {
        [
            [this._blk.drag,           [_('Mobilize'), _('Allow dragging to displace')]],
            [[_('Systray position')],  this._blk.index],
            [[_('Refresh interval')],  this._blk.span],
            [[_('Lyric orientation')], this._blk.orient],
            [[_('Lyric location')],    this._blk.path],
            [[_('Lyric colors')],      this._blk.acolor, this._blk.icolor, this._blk.ocolor],
            [[_('Font name')],         this._blk.font],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
