// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

import {DBusProxy, Mortal, Source} from './fubar.js';
import {id, vmap, pickle, noop, string} from './util.js';

const MPRIS_IFACE = loadInterfaceXML('org.mpris.MediaPlayer2');
const MPRIS_PLAYER_IFACE = `<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <signal name="Seeked">
      <arg type="x" direction="out" name="pos"/>
    </signal>
  </interface>
</node>`;

export class Mpris extends Mortal {
    constructor() {
        super();
        this.$src = Source.fuse({
            dbus: new DBusProxy('org.freedesktop.DBus', '/org/freedesktop/DBus', x => x && this.$onMprisChange(), null,
                ['NameOwnerChanged', (_p, _s, [name, old, neo]) => { if(neo && !old) this.$buildMpris(name).catch(noop); }]),
            mpris: new Source(x => new DBusProxy(x, '/org/mpris/MediaPlayer2', y => y && this.$src.player.revive(y.gName),
                ['notify::g-name-owner', (...xs) => this.$onMprisChange(...xs)], null, MPRIS_IFACE)),
            player: new Source(x => new DBusProxy(x, '/org/mpris/MediaPlayer2', (...xs) => this.$onPlayerReady(...xs),
                ['g-properties-changed', (...xs) => this.$onPlayerChange(...xs)],
                ['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)], MPRIS_PLAYER_IFACE)),
        }, this);
    }

    $onPlayerReady(proxy) {
        if(!proxy) return;
        this.emit('closed', false);
        this.$updateMetadata(proxy.Metadata);
    }

    async $buildMpris(name) {
        if(this.$src.mpris.active) return;
        if(!name.startsWith('org.mpris.MediaPlayer2.')) throw Error('non mpris');
        let {DesktopEntry, Identity} = await Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE).newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2'),
            app = DesktopEntry ? `${DesktopEntry}.desktop` : Identity ? Shell.AppSystem.search(Identity)[0] : null,
            cat = app ? Shell.AppSystem.get_default().lookup_app(app)?.get_app_info().get_string('Categories').split(';') : null;
        // HACK: allow terminal music apps (no DesktopEntry), see also https://gitlab.gnome.org/GNOME/glib/-/issues/1584
        if(cat && (!cat.includes('AudioVideo') || cat.includes('Video'))) throw Error('non musical');
        this.$src.mpris.summon(name);
    }

    $onMprisChange(proxy) {
        if(proxy?.gNameOwner) return;
        this.$src.mpris.dispel();
        this.$src.player.dispel();
        this.emit('closed', true);
        this.$src.dbus.ListNamesAsync(([xs]) => Promise.any(xs.map(x => this.$buildMpris(x))).catch(noop));
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
        if(!string(title) || !title) return;
        this.emit('update', {
            artist: artist?.every?.(string) ? artist.flatMap(x => x.split('/')).filter(id).sort() : [],
            length: length / 1000, album: string(album) ? album : '', lyric: string(lyric) ? lyric : null, title,
        });
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this.$src.mpris.hub.gName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', pickle(['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.player.hub?.PlaybackStatus === 'Playing';
    }
}
