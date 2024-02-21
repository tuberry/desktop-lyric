// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import * as UI from './ui.js';

const {_} = UI;

class DesktopLyricPrefs extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super();
        this._buildWidgets(gset);
        this._buildUI();
    }

    _buildWidgets(gset) {
        this._blk = UI.block({
            FONT: [new UI.Font()],
            DRAG: [new UI.Switch()],
            SPAN: [new UI.Spin(20, 500, 10)],
            PATH: [new UI.File({select_folder: true})],
            ACLR: [new UI.Color({title: _('Active color')})],
            OCLR: [new UI.Color({title: _('Outline color')})],
            ICLR: [new UI.Color({title: _('Inactive color')})],
            ORNT: [new UI.Drop([_('Horizontal'), _('Vertical')])],
            TIDX: [new UI.Drop([_('Left'), _('Center'), _('Right')])],
        }, gset);
    }

    _buildUI() {
        [
            [[_('Mobilize'), _('Allow dragging to displace')], this._blk.DRAG],
            [[_('Systray position')],  this._blk.TIDX],
            [[_('Refresh interval')],  this._blk.SPAN],
            [[_('Lyric orientation')], this._blk.ORNT],
            [[_('Lyric location')],    this._blk.PATH],
            [[_('Lyric colors')],      this._blk.ACLR, this._blk.ICLR, this._blk.OCLR],
            [[_('Font name')],         this._blk.FONT],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}

export default class PrefsWidget extends UI.Prefs { $klass = DesktopLyricPrefs; }
