// vim:fdm=syntax
// by tuberry
/* exported MprisPlayer */
'use strict';

const { Shell, Gio, GLib } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { DummyActor, omit, onus, symbiose } = Me.imports.fubar;
const { id, amap } = Me.imports.util;

const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';
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

var MprisPlayer = class extends DummyActor {
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
                () => this._proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => { (neo && !old) && this._setPlayer(name); })],
        });
        this._sbt.dbus.revive();
        this._onProxyReady();
    }

    _isMusicApp(app) {
        if(!app.startsWith(MPRIS_PLAYER_PREFIX)) return false;
        try {
            let sfx = app.replace(new RegExp(`^${MPRIS_PLAYER_PREFIX}`), ''),
                dsk = Shell.AppSystem.search(sfx).at(0)?.at(0) || `${sfx}.desktop`,
                ctg = Shell.AppSystem.get_default().lookup_app(dsk).get_app_info().get_string('Categories').split(';');
            return ctg.includes('AudioVideo') && !ctg.includes('Video');
        } catch(e) {
            return false;
        }
    }

    async _setPlayer(app) {
        if(this._app || !this._isMusicApp(app)) return;
        this._app = app;
        try {
            this._mpris = await MprisProxy.newAsync(Gio.DBus.session, app, '/org/mpris/MediaPlayer2');
            this._player = await PlayerProxy.newAsync(Gio.DBus.session, app, '/org/mpris/MediaPlayer2');
            this._mpris.connectObject('notify::g-name-owner', () => this._onMprisOwn(), onus(this));
            this._player.connectObject('g-properties-changed', this._onPropsChanged.bind(this), onus(this));
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
        ['_mpris', '_player'].forEach(x => this[x]?.disconnectObject(onus(this)));
        omit(this, '_app', '_mpris', '_player');
        this.emit('closed', true);
        this._onProxyReady();
    }

    _onPlayerReady() {
        this._sbt.player.revive();
        this.emit('closed', false);
        this._updateMetadata(amap(this._player.Metadata ?? {}, v => v.deepUnpack()));
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this._app, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0);
    }

    _updateMetadata(data) {
        // filter dirty data; https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (data['mpris:length'] ?? 0) / 1000,
            title = typeof data['xesam:title'] === 'string' ? data['xesam:title'] : '',
            album = typeof data['xesam:album'] === 'string' ? data['xesam:album'] : '',
            artist = data['xesam:artist']?.every?.(x => typeof x === 'string')
                ? data['xesam:artist'].flatMap(x => x.split('/')).filter(id).sort() : [];
        if(title) this.emit('update', { title, artist, album }, length);
    }

    get status() {
        return this._player?.PlaybackStatus ?? 'Stopped';
    }

    _onPropsChanged(_p, changed) {
        let props = changed.recursiveUnpack();
        if('Metadata' in props) this._updateMetadata(props.Metadata);
        if('PlaybackStatus' in props) this.emit('status', this.status);
    }
};
