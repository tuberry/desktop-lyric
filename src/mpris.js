// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';

import * as T from './util.js';
import * as F from './fubar.js';

const MPRIS_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2');

export default class Mpris extends F.Mortal {
    constructor() {
        super();
        this.#buildSources(FileUtils.loadInterfaceXML('org.gnome.Shell.Extensions.DesktopLyric.MprisPlayer'));
    }

    #buildSources(playerIface) {
        let dbus = new F.DBusProxy('org.freedesktop.DBus', '/org/freedesktop/DBus', x => x && this.#onMprisChange(), null,
                ['NameOwnerChanged', (_p, _s, [name, old, neo]) => { if(neo && !old) this.#buildMpris(name).catch(T.nop); }]),
            mpris = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', y => y && this.$src.player.revive(y.gName),
                ['notify::g-name-owner', (...xs) => this.#onMprisChange(...xs)], null, MPRIS_IFACE)),
            player = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', (...xs) => this.#onPlayerReady(...xs),
                ['g-properties-changed', (...xs) => this.#onPlayerChange(...xs)], ['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)], playerIface));
        this.$src = F.Source.tie({dbus, mpris, player}, this);
    }

    #activate(active) {
        this.emit('active', this.active = active);
    }

    #onPlayerReady(proxy) {
        if(!proxy) return;
        this.#activate(true);
        this.#update(proxy.Metadata);
    }

    async #buildMpris(name) {
        if(this.$src.mpris.active) return;
        if(!name.startsWith('org.mpris.MediaPlayer2.')) throw Error('non mpris');
        let {DesktopEntry, Identity} = await Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE).newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2'),
            app = DesktopEntry ? `${DesktopEntry}.desktop` : Identity ? Shell.AppSystem.search(Identity)[0]?.[0] : null,
            cat = app ? Shell.AppSystem.get_default().lookup_app(app)?.get_app_info().get_string('Categories').split(';') : null;
        // HACK: allow terminal music apps (no DesktopEntry), see also https://gitlab.gnome.org/GNOME/glib/-/issues/1584
        if(cat?.reduce((p, x) => { p[0] &&= x !== 'AudioVideo'; p[1] ||= x === 'Video'; return p; }, [true, false]).some(T.id)) throw Error('non musical');
        this.$src.mpris.summon(name);
    }

    #onMprisChange(proxy) {
        if(proxy?.gNameOwner) return;
        this.$src.mpris.dispel();
        this.$src.player.dispel();
        this.#activate(false);
        this.$src.dbus.ListNamesAsync(([xs]) => Promise.any(xs.map(x => this.#buildMpris(x))).catch(T.nop));
    }

    #onPlayerChange(proxy, prop) {
        if(prop.lookup_value('Metadata', null)) this.#update(proxy.Metadata);
        if(prop.lookup_value('PlaybackStatus', null)) this.emit('status', this.status);
    }

    #update(metadata) {
        let {
            'xesam:title': title, 'xesam:artist': artist, 'xesam:asText': lyric,
            'xesam:album': album, 'mpris:length': length = 0,
        } = T.vmap(metadata, v => v.deepUnpack()); // Ref: https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        if(!T.str(title) || !title) return;
        this.emit('update', {
            artist: artist?.every?.(T.str) ? artist.flatMap(x => x.split('/')).filter(T.id) : [],
            length: length / 1000, album: T.str(album) ? album : '', lyric: T.str(lyric) ? lyric : null, title,
        });
    }

    async getPosition() { // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this.$src.mpris.hub.gName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', T.pickle(['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.player.hub?.PlaybackStatus === 'Playing';
    }
}
