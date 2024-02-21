// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

import {Destroyable, symbiose, omit} from './fubar.js';
import {id, hook, xnor, vmap, noop, has} from './util.js';

const MPRIS_PLAYER_IFACE = `<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <signal name="Seeked">
      <arg type="x" direction="out" name="pos"/>
    </signal>
  </interface>
</node>`;

const DBusProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.DBus'));
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2'));
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);

export class Mpris extends Destroyable {
    constructor() {
        super();
        this._buildWidgets();
    }

    async _buildWidgets() {
        symbiose(this, () => omit(this, 'dbus', '_proxy'));
        this._proxy = await DBusProxy.newAsync(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
        this._proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => { if(neo && !old) this.dbus = name; });
        this._onMprisChange();
    }

    _onMprisChange() {
        if(this._mpris?.g_name_owner) return;
        omit(this, 'dbus');
        this._proxy.ListNamesAsync(([names]) => names.forEach(x => { this.dbus = x; }));
    }

    _onPlayerChange(data = {}) {
        let prop = data.recursiveUnpack();
        if(has(prop, 'Metadata')) this._updateMetadata(prop.Metadata);
        if(has(prop, 'PlaybackStatus')) this.emit('status', this.status);
    }

    _notMusical(mpris) {
        let app = Shell.AppSystem.get_default().lookup_app(`${mpris.DesktopEntry ?? ''}.desktop`);
        let ctg = app?.get_app_info().get_string('Categories').split(';') ?? [];
        return ctg.includes('AudioVideo') && !ctg.includes('Video');
    }

    async _buildDBus(dbus) {
        if(!dbus.startsWith('org.mpris.MediaPlayer2.')) throw Error('not mpris');
        let mpris = await MprisProxy.newAsync(Gio.DBus.session, dbus, '/org/mpris/MediaPlayer2');
        if(!this._notMusical(mpris)) throw Error('not music app');
        this._dbus = dbus;
        this._mpris = hook({'notify::g-name-owner': () => this._onMprisChange()}, mpris);
        this._player = hook({'g-properties-changed': (_p, data) => this._onPlayerChange(data)},
            await PlayerProxy.newAsync(Gio.DBus.session, dbus, '/org/mpris/MediaPlayer2'));
        this._player.connectSignal('Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000));
        this._updateMetadata(vmap(this._player.Metadata, v => v.deepUnpack()));
        this.emit('closed', false);
        this._onMprisChange();
    }

    set dbus(dbus) {
        if(xnor(dbus, this._dbus)) return;
        if(dbus) {
            this._buildDBus(dbus).catch(noop);
        } else {
            omit(this, '_dbus', '_mpris', '_player');
            this.emit('closed', true);
        }
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this._dbus, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    _updateMetadata(data) {
        // filter dirty data; https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (data['mpris:length'] ?? 0) / 1000,
            title = typeof data['xesam:title'] === 'string' ? data['xesam:title'] : '',
            album = typeof data['xesam:album'] === 'string' ? data['xesam:album'] : '',
            lyric = typeof data['xesam:asText'] === 'string' ? data['xesam:asText'] : null,
            artist = data['xesam:artist']?.every?.(x => typeof x === 'string')
                ? data['xesam:artist'].flatMap(x => x.split('/')).filter(id).sort() : [];
        if(title) this.emit('update', {title, album, lyric, artist, length});
    }

    get status() {
        return this._player?.PlaybackStatus === 'Playing';
    }
}
