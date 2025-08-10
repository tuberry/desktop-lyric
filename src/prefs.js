// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K, URL} from './const.js';

const {_} = UI;

class DesktopLyricPrefs extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        return [
            [K.FONT, new UI.Font()],
            [K.DRAG, new UI.Switch()],
            [K.ONLN, new UI.Switch()],
            [K.PRGR, new UI.Switch()],
            [K.FABK, new UI.Switch()],
            [K.OPCT, new UI.Spin(20, 100, 5, '%')],
            [K.SPAN, new UI.Spin(20, 500, 10, _('ms'))],
            [K.ORNT, new UI.Drop([_('Horizontal'), _('Vertical')])],
            [K.PRVD, new UI.Drop([_('NetEase Cloud'), _('NetEase Cloud (Trans)'), _('LRCLIB')])],
            [K.AREA, new UI.Drop([_('Left'), _('Center'), _('Right')])],
            [K.PATH, new UI.File({folder: true, size: true, open: true})],
        ];
    }

    $buildUI() {
        this.$add([null, [
            [[_('_Show progress')], K.PRGR],
            [[_('S_ystray position')], K.AREA],
            [[_('_Refresh interval')], K.SPAN],
        ]], [[[_('Desktop')]], [
            [[_('_Mobilize'), _('Allow dragging to displace')], K.DRAG],
            [[_('_Opacity')], K.OPCT],
            [[_('_Font')], K.FONT],
            [[_('Or_ientation')], K.ORNT],
        ]], [[[_('Online'), _('Try to download and save the missing lyrics')], K.ONLN], [
            [[_('_Provider'), _('Prefer <a href="%s">lyrics from Mpris metadata</a>').format('https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/#xesam:astext')],
                new UI.Help(({h}) => [h(_('URL')), [
                    [_('NetEase Cloud'), `<a href="${URL.NCM}">${URL.NCM}</a>`],
                    [_('LRCLIB'), `<a href="${URL.LRCLIB}">${URL.LRCLIB}</a>`],
                ]]), K.PRVD],
            [[_('F_allback'), _('Use the first result when searches cannot be matched precisely')], K.FABK],
            [[_('_Location'), _('Filename format: <i>Title-Artist1,Artist2-Album.lrc</i>')], K.PATH],
        ]]);
    }
}

export default class extends UI.Prefs { $klass = DesktopLyricPrefs; }
