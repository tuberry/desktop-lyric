// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K, URL, ColorPreset, Colors} from './const.js';

const {_} = UI;

class DesktopLyricPrefs extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        // Get system accent color
        const styleManager = UI.Adw.StyleManager.get_default();
        const accentColor = styleManager.get_accent_color();
        
        // Convert Adw.AccentColor enum to RGB
        const accentColorMap = {
            [UI.Adw.AccentColor.BLUE]: [0.24, 0.55, 0.92],
            [UI.Adw.AccentColor.TEAL]: [0.13, 0.74, 0.66],
            [UI.Adw.AccentColor.GREEN]: [0.30, 0.69, 0.29],
            [UI.Adw.AccentColor.YELLOW]: [0.96, 0.76, 0.05],
            [UI.Adw.AccentColor.ORANGE]: [1.0, 0.47, 0.0],
            [UI.Adw.AccentColor.RED]: [0.91, 0.16, 0.22],
            [UI.Adw.AccentColor.PINK]: [0.91, 0.38, 0.65],
            [UI.Adw.AccentColor.PURPLE]: [0.61, 0.31, 0.85],
            [UI.Adw.AccentColor.SLATE]: [0.45, 0.52, 0.59],
        };
        
        const systemColor = accentColorMap[accentColor] || [0.5, 0.7, 1.0];
        
        // Create color options here (not at module level) to avoid gettext errors
        const colorOptions = [
            {label: _('System'), color: systemColor},
            {label: _('White'), color: Colors[ColorPreset.WHITE]},
            {label: _('Black'), color: Colors[ColorPreset.BLACK]},
            {label: _('Green'), color: Colors[ColorPreset.GREEN]},
            {label: _('Orange'), color: Colors[ColorPreset.ORANGE]},
            {label: _('Yellow'), color: Colors[ColorPreset.YELLOW]},
            {label: _('Blue'), color: Colors[ColorPreset.BLUE]},
            {label: _('Red'), color: Colors[ColorPreset.RED]},
            {label: _('Purple'), color: Colors[ColorPreset.PURPLE]},
        ];
        
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
            [K.ACLR, new UI.ColorDrop(colorOptions)],
            [K.ICLR, new UI.ColorDrop(colorOptions)],
        ];
    }

    $buildUI() {
        this.$add(
            // Appearance group
            [[[_('Appearance')]], [
                [[_('_Font')], K.FONT],
                [[_('_Opacity'), _('Transparency of desktop lyric')], K.OPCT],
                [[_('Or_ientation'), _('Display direction of lyrics')], K.ORNT],
                [[_('_Active color'), _('Progress/played lyric color')], K.ACLR],
                [[_('_Inactive color'), _('Main/unplayed lyric color')], K.ICLR],
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
            [[[_('Lyrics Source'), _('Enable online lyrics download when local lyrics are missing')], K.ONLN], [
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
