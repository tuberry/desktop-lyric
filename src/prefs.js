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
            [K.AVPL, new UI.Switch()],
            [K.OPCT, new UI.Spin(20, 100, 5, '%')],
            [K.SPAN, new UI.Spin(20, 500, 10, _('ms'))],
            [K.PWID, new UI.Spin(100, 800, 50, _('px'))],
            [K.ORNT, new UI.Drop([_('Horizontal'), _('Vertical')])],
            [K.AREA, new UI.Drop([_('Left'), _('Center'), _('Right')])],
            [K.PATH, new UI.File({folder: true, size: true, open: true})],
            [K.PRVD, new UI.Drop([_('NetEase Cloud'), _('NetEase Cloud (Trans)'), _('LRCLIB')])],
        ];
    }

    $buildUI() {
        this.$add(
            // Appearance group
            [[[_('Appearance')]], [
                [[_('_Font')], K.FONT],
                [[_('_Opacity'), _('Transparency of desktop lyric')], K.OPCT],
                [[_('Or_ientation'), _('Display direction of lyrics')], K.ORNT],
            ]], 
            
            // Behavior group
            [[[_('Behavior')]], [
                [[_('_Mobilize'), _('Allow dragging to displace desktop lyric position')], K.DRAG],
                [[_('_Show progress'), _('Display playback progress on lyrics')], K.PRGR],
                [[_('_Refresh interval'), _('Lower values = smoother but higher CPU usage')], K.SPAN],
            ]], 
            
            // Player group
            [[[_('Player')]], [
                [[_('S_ystray position'), _('Position of the system tray icon')], K.AREA],
                [[_('Panel _width'), _('Fixed width of panel lyric in pixels (minimized mode only)')], K.PWID],
                [[_('Allow _video players'), _('Allow Chromium/Electron-based players to be recognized')], K.AVPL],
            ]], 
            
            // Lyrics Source group
            [[[_('Lyrics Source')]], [
                [[_('_Online'), _('Try to download and save the missing lyrics')], K.ONLN],
                [[_('_Provider'), _('Prefer <a href="%s">lyrics from Mpris metadata</a>').format('https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/#xesam:astext')],
                    new UI.Help(({h}) => [h(_('URL')), [
                        [_('NetEase Cloud'), `<a href="${URL.NCM}">${URL.NCM}</a>`],
                        [_('LRCLIB'), `<a href="${URL.LRCLIB}">${URL.LRCLIB}</a>`],
                    ]]), K.PRVD],
                [[_('F_allback'), _('Use the first result when searches cannot be matched precisely')], K.FABK],
                [[_('_Location'), _('Filename format: <i>Title-Artist1,Artist2-Album.lrc</i>')], K.PATH],
            ]]
        );
    }
}

export default class extends UI.Prefs { $klass = DesktopLyricPrefs; }
