// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';

import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K, URL} from './const.js';

const {$, $$} = T;
const {_, _G, getv, setv} = UI;

class Players extends Gtk.MenuButton {
    static {
        UI.enrol(this, GLib.strv_get_type());
    }

    constructor() {
        super({valign: Gtk.Align.CENTER, label: _('Pinned'), popover: new Gtk.Popover()})[$]
            .bind_property_full(getv, this.popover, 'child', T.SYNC, (_b, v) => [true, v?.length
                ? new Adw.WrapBox({childSpacing: 8, lineSpacing: 8, naturalLineLength: 256})[$$]
                .append(v.map(x => new Gtk.Button({child: new UI.Sign('window-close-symbolic', true)[$].setup('', x)})[$]
                    .add_css_class('destructive-action')[$].connect('clicked', () => this[setv](this[getv].filter(y => y !== x)))))
                : new Gtk.Button({label: _G('(None)'), sensitive: false})], null);
    }
}

class DesktopLyricPrefs extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        return [
            [K.PLST, new Players()],
            [K.FONT, new UI.Font()],
            [K.DRAG, new UI.Switch()],
            [K.ONLN, new UI.Switch()],
            [K.PRGR, new UI.Switch()],
            [K.FABK, new UI.Switch()],
            [K.DCLR, new UI.Color(_('Decor color'))],
            [K.ACLR, new UI.Color(_('Active color'))],
            [K.ICLR, new UI.Color(_('Inactive color'))],
            [K.SPAN, new UI.Spin(20, 500, 10, _('ms'))],
            [K.PLCY, new UI.Drop([_('Prefer'), _('Only')])],
            [K.ORNT, new UI.Drop([_('Horizontal'), _('Vertical')])],
            [K.PATH, new UI.File({folder: true, size: true, open: true})],
            [K.DCTP, new UI.Drop([_('Outline'), _('Background')], _('Type'))],
            [K.PNWD, new UI.Spin(100, 800, 50, _('px'), _('Panel lyric width'))],
            [K.AREA, new UI.Drop([_('Left'), _('Center'), _('Right')], _('Position'))],
            [K.PRVD, new UI.Drop([_('NetEase Cloud'), _('NetEase Cloud (Trans)'), _('LRCLIB')])],
        ];
    }

    $buildUI() {
        this.$add([null, [
            [[_('_Show progress')], K.PRGR],
            [[_('_Refresh interval')], K.SPAN],
            [[_('S_ystray')], K.AREA, K.PNWD],
            [[_('_Color')], K.ACLR, K.ICLR],
            [[_('Play_er')], K.PLCY, K.PLST],
        ]], [[[_('Desktop')]], [
            [[_('_Mobilize'), _('Allow dragging to displace')], K.DRAG],
            [[_('_Font')], K.FONT],
            [[_('_Decoration')], K.DCTP, K.DCLR],
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
