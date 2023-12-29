// vim:fdm=syntax
// by tuberry

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';

import { id, vmap } from './util.js';
import { Destroyable, omit, connect, disconnect, symbiose } from './fubar.js';

const MPRIS_PLAYER_IFACE =
`<node>
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

export class MprisPlayer extends Destroyable {
    constructor() {
        super();
        this._buildWidgets();
    }

    async _buildWidgets() {
        this._proxy = await DBusProxy.newAsync(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
        this._sbt = symbiose(this, () => this.emit('closed', true), {
            player: [x => x && this._player?.disconnectSignal(x),
                () => this._player?.connectSignal('Seeked', (_p, _s, [pos]) => this.emit('seeked', pos))],
            dbus: [x => x && this._proxy.disconnectSignal(x),
                () => this._proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => { if(neo && !old) this._setPlayer(name); })],
        });
        this._sbt.dbus.revive();
        this._onProxyReady();
    }

    async _buildMprisProxy(bus_name) {
        if(this._bus_name || !bus_name.startsWith('org.mpris.MediaPlayer2.')) return;
        try {
            let mpris = await MprisProxy.newAsync(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2'),
                app = Shell.AppSystem.get_default().lookup_app(`${mpris.DesktopEntry ?? ''}.desktop`),
                ctg = app?.get_app_info().get_string('Categories').split(';') ?? [];
            if(ctg.includes('AudioVideo') && !ctg.includes('Video')) return mpris;
        } catch(e) {
            // ignore
        }
    }

    async _setPlayer(bus_name) {
        let mpris = await this._buildMprisProxy(bus_name);
        if(!mpris) return;
        this._bus_name = bus_name;
        try {
            this._mpris = mpris;
            this._player = await PlayerProxy.newAsync(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2');
            connect(this, [this._mpris, 'notify::g-name-owner', () => this._onMprisOwn()],
                [this._player, 'g-properties-changed', this._onPlayerChange.bind(this)]);
            this._onPlayerReady();
            this._onMprisOwn();
        } catch(e) {
            logError(e);
        }
    }

    _onProxyReady() {
        this._proxy.ListNamesAsync(([xs]) => xs.forEach(x => this._setPlayer(x)));
    }

    _onMprisOwn() {
        if(this._mpris?.g_name_owner) return;
        this._sbt.player.dispel();
        disconnect(this, this._mpris, this._player);
        omit(this, '_bus_name', '_mpris', '_player');
        this.emit('closed', true);
        this._onProxyReady();
    }

    _onPlayerReady() {
        this._sbt.player.revive();
        this.emit('closed', false);
        this._updateMetadata(vmap(this._player.Metadata ?? {}, v => v.deepUnpack()));
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this._bus_name, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0);
    }

    _updateMetadata(data) {
        // filter dirty data; https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (data['mpris:length'] ?? 0) / 1000,
            title = typeof data['xesam:title'] === 'string' ? data['xesam:title'] : '',
            album = typeof data['xesam:album'] === 'string' ? data['xesam:album'] : '',
            lyric = typeof data['xesam:asText'] === 'string' ? data['xesam:asText'] : null,
            artist = data['xesam:artist']?.every?.(x => typeof x === 'string')
                ? data['xesam:artist'].flatMap(x => x.split('/')).filter(id).sort() : [];
        if(title) this.emit('update', { title, album, artist, lyric }, length);
    }

    get status() {
        return this._player?.PlaybackStatus ?? 'Stopped';
    }

    _onPlayerChange(_p, data) {
        let props = data.recursiveUnpack();
        if('Metadata' in props) this._updateMetadata(props.Metadata);
        if('PlaybackStatus' in props) this.emit('status', this.status);
    }
}
