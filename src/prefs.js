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
        this.#buildWidgets(gset);
        this.#buildUI();
    }

    #buildWidgets(gset) {
        this.$blk = UI.tie({
            FONT: new UI.Font(),
            DRAG: new UI.Switch(),
            ONLN: new UI.Switch(),
            PROV: new UI.Drop([_('NetEase Cloud'), _('LRCLIB')]),
            PRGR: new UI.Switch(),
            SPAN: new UI.Spin(20, 500, 10),
            PATH: new UI.File({folder: true}),
            ORNT: new UI.Drop([_('Horizontal'), _('Vertical')]),
            AREA: new UI.Drop([_('Left'), _('Center'), _('Right')]),
            FABK: new UI.Switch(),
        }, gset);
    }

    #buildUI() {
        UI.addActRows([
            [[_('_Mobilize'), _('Allow dragging to displace')], this.$blk.DRAG],
            [[_('_Show progress'), _('Prefer <a href="https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/#xesam:astext">lyrics from Mpris metadata</a>')], this.$blk.PRGR],
            [[_('_Online lyrics'), _('Try to download missing lyrics from the specified online provider')], this.$blk.ONLN],
            [[_('O_nline provider')], this.$blk.PROV],
            [[_('S_ystray position')], this.$blk.AREA],
            [[_('_Refresh interval'), _('Unit: millisecond')], this.$blk.SPAN],
            [[_('_Lyric orientation')], this.$blk.ORNT],
            [[_('Lyr_ic location'), _('<a href="https://en.wikipedia.org/wiki/LRC_(file_format)">LRC</a> filename format: <i>Title-Artist1,Artist2-Album.lrc</i>')], this.$blk.PATH],
            [[_('_Font name')], this.$blk.FONT],
            [[_('F_allback'), _('Use the first search result when lyrics can not be matched precisely.')], this.$blk.FABK],
        ], this);
    }
}

export default class Prefs extends UI.Prefs { $klass = DesktopLyricPrefs; }
