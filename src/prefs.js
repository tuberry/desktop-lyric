// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Field } = Me.imports.const;
const { _ } = Me.imports.util;
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
        this._blk = new UI.Block({
            drag:   [Field.DRAG,     'active',   new Gtk.CheckButton()],
            span:   [Field.INTERVAL, 'value',    new UI.Spin(50, 500, 10)],
            acolor: [Field.ACTIVE,   'colour',   new UI.Color(_('Active color'))],
            ocolor: [Field.OUTLINE,  'colour',   new UI.Color(_('Outline color'))],
            icolor: [Field.INACTIVE, 'colour',   new UI.Color(_('Inactive color'))],
            orient: [Field.ORIENT,   'selected', new UI.Drop([_('Horizontal'), _('Vertical')])],
            font:   [Field.FONT,     'font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            index:  [Field.INDEX,    'selected', new UI.Drop([_('Left'), _('Center'), _('Right')])],
            path:   [Field.LOCATION, 'file',     new UI.File({ action: Gtk.FileChooserAction.SELECT_FOLDER })],
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
