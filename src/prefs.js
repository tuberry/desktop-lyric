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
            SPAN: new UI.Spin(20, 500, 10),
            PATH: new UI.File({folder: true}),
            ACLR: new UI.Color({title: _('Active color')}),
            OCLR: new UI.Color({title: _('Outline color')}),
            ICLR: new UI.Color({title: _('Inactive color')}),
            ORNT: new UI.Drop([_('Horizontal'), _('Vertical')]),
            TIDX: new UI.Drop([_('Left'), _('Center'), _('Right')]),
        }, gset);
    }

    $buildUI() {
        [
            [[_('Mobilize'), _('Allow dragging to displace')], this.$blk.DRAG],
            [[_('Online lyrics'), _('Download missing lyrics from <a href="https://music.163.com">Netease Cloud</a>')], this.$blk.ONLN],
            [[_('Systray position')],  this.$blk.TIDX],
            [[_('Refresh interval')],  this.$blk.SPAN],
            [[_('Lyric orientation')], this.$blk.ORNT],
            [[_('Lyric location')],    this.$blk.PATH],
            [[_('Lyric colors')],      this.$blk.ACLR, this.$blk.ICLR, this.$blk.OCLR],
            [[_('Font name')],         this.$blk.FONT],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}

export default class PrefsWidget extends UI.Prefs { $klass = DesktopLyricPrefs; }
