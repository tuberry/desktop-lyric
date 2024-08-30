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
        this.$buildWidgets(gset);
        this.$buildUI();
    }

    $buildWidgets(gset) {
        this.$blk = UI.block({
            FONT: new UI.Font(),
            DRAG: new UI.Switch(),
            ONLN: new UI.Switch(),
            PRGR: new UI.Switch(),
            PATH: new UI.File({folder: true}),
            ORNT: new UI.Drop([_('Horizontal'), _('Vertical')]),
            SPAN: new UI.Spin(20, 500, 10, _('Unit: millisecond')),
            TIDX: new UI.Drop([_('Left'), _('Center'), _('Right')]),
        }, gset);
    }

    $buildUI() {
        [
            [[_('_Mobilize'),           _('Allow dragging to displace')], this.$blk.DRAG],
            [[_('_Online lyrics'),      _('Download missing lyrics from <a href="https://music.163.com">Netease Cloud</a>')], this.$blk.ONLN],
            [[_('_Show progress')],     this.$blk.PRGR],
            [[_('S_ystray position')],  this.$blk.TIDX],
            [[_('_Refresh interval')],  this.$blk.SPAN],
            [[_('_Lyric orientation')], this.$blk.ORNT],
            [[_('Lyr_ic location')],    this.$blk.PATH],
            [[_('_Font name')],         this.$blk.FONT],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}

export default class PrefsWidget extends UI.Prefs { $klass = DesktopLyricPrefs; }
