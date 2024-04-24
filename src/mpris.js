// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

import {id, hook, vmap, pickle} from './util.js';
import {Mortal, Source, degrade} from './fubar.js';

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

const isStr = x => typeof x === 'string';

export class Mpris extends Mortal {
    constructor() {
        super();
        this.$src = degrade({
            dbus: new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this.$onDBusReady.bind(this)),
            mpris: new Source(x => hook({'notify::g-name-owner': this.$onMprisChange.bind(this)}, x)),
            player: new Source(x => hook({'g-properties-changed': this.$onPlayerChange.bind(this)},
                new PlayerProxy(Gio.DBus.session, x, '/org/mpris/MediaPlayer2', this.$onPlayerReady.bind(this)))),
        }, this);
    }

    $onDBusReady(proxy) {
        if(!proxy) return;
        proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => { if(neo && !old) this.$buildMpris(name); });
        this.$onMprisChange();
    }

    $onPlayerReady(proxy) {
        if(!proxy) return;
        this.emit('closed', false);
        this.$updateMetadata(proxy.Metadata);
        proxy.connectSignal('Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000));
    }

    async $buildMpris(name) {
        if(this.$src.mpris.active || !name.startsWith('org.mpris.MediaPlayer2.')) return;
        let mpris = await MprisProxy.newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2'),
            app = Shell.AppSystem.get_default().lookup_app(`${mpris.DesktopEntry ?? ''}.desktop`),
            ctg = app?.get_app_info().get_string('Categories').split(';') ?? [];
        if(!ctg.includes('AudioVideo') || ctg.includes('Video')) return;
        this.$src.mpris.summon(mpris);
        this.$src.player.revive(name);
    }

    $onMprisChange(proxy) {
        if(proxy?.g_name_owner) return;
        this.$src.mpris.dispel();
        this.$src.player.dispel();
        this.emit('closed', true);
        this.$src.dbus.ListNamesAsync(([names]) => names.forEach(x => this.$buildMpris(x)));
    }

    $onPlayerChange(proxy, prop) {
        if(prop.lookup_value('Metadata', null)) this.$updateMetadata(proxy.Metadata);
        if(prop.lookup_value('PlaybackStatus', null)) this.emit('status', this.status);
    }

    $updateMetadata(data) {
        // Ref: https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let {
            'xesam:title': title, 'xesam:artist': artist, 'xesam:asText': lyric,
            'xesam:album': album, 'mpris:length': length = 0,
        } = vmap(data, v => v.deepUnpack());
        if(!isStr(title) || !title) return;
        this.emit('update', {
            artist: artist?.every?.(isStr) ? artist.flatMap(x => x.split('/')).filter(id).sort() : [],
            length: length / 1000, album: isStr(album) ? album : '', lyric: isStr(lyric) ? lyric : null, title,
        });
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this.$src.mpris.hub.g_name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', pickle(['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.player.hub?.PlaybackStatus === 'Playing';
    }
}
