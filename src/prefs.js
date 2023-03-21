// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
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
        this._blk = UI.block({
            FONT: ['value',    new UI.Font()],
            DRAG: ['active',   new Gtk.CheckButton()],
            SPAN: ['value',    new UI.Spin(50, 500, 10)],
            PATH: ['value',    new UI.File({ select_folder: true })],
            ACLR: ['value',    new UI.Color({ title: _('Active color') })],
            OCLR: ['value',    new UI.Color({ title: _('Outline color') })],
            ICLR: ['value',    new UI.Color({ title: _('Inactive color') })],
            ORNT: ['selected', new UI.Drop([_('Horizontal'), _('Vertical')])],
            TIDX: ['selected', new UI.Drop([_('Left'), _('Center'), _('Right')])],
        });
    }

    _buildUI() {
        [
            [this._blk.DRAG,           [_('Mobilize'), _('Allow dragging to displace')]],
            [[_('Systray position')],  this._blk.TIDX],
            [[_('Refresh interval')],  this._blk.SPAN],
            [[_('Lyric orientation')], this._blk.ORNT],
            [[_('Lyric location')],    this._blk.PATH],
            [[_('Lyric colors')],      this._blk.ACLR, this._blk.ICLR, this._blk.OCLR],
            [[_('Font name')],         this._blk.FONT],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
