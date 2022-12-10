// vim:fdm=syntax
// by tuberry
/* exported MprisPlayer */
'use strict';

const { Shell, Gio, GLib } = imports.gi;
const { EventEmitter } = imports.misc.signals;
const { loadInterfaceXML } = imports.misc.fileUtils;
const noop = () => {};

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

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

var MprisPlayer = class extends EventEmitter {
    constructor() {
        super();
        let DbusProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.DBus'));
        this._dbus = new DbusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', () => this._onProxyReady());
        this._dbus.init_async(GLib.PRIORITY_DEFAULT, null).catch(noop);
    }

    _isMusicApp(app) {
        if(!app.startsWith(MPRIS_PLAYER_PREFIX)) return false;
        let name = app.replace(new RegExp(`^${MPRIS_PLAYER_PREFIX}`), '');
        let [appid] = Shell.AppSystem.search(name).toString().split(',');
        try {
            let cat = Shell.AppSystem.get_default().lookup_app(appid || `${name}.desktop`).get_app_info().get_string('Categories').split(';');
            return cat.includes('AudioVideo') && !cat.includes('Video');
        } catch(e) {
            return false;
        }
    }

    _setPlayer(app) {
        if(this._app || !this._isMusicApp(app)) return;
        this._app = app;
        let MprisProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2'));
        this._mpris = new MprisProxy(Gio.DBus.session, app, '/org/mpris/MediaPlayer2', () => this._onMprisProxyReady());
        let PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);
        this._player = new PlayerProxy(Gio.DBus.session, app, '/org/mpris/MediaPlayer2', () => this._onPlayerProxyReady());
    }

    async _onProxyReady() {
        let [names] = await this._dbus.ListNamesAsync();
        names.forEach(name => this._setPlayer(name));
        this._dbus.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => (neo && !old) && this._setPlayer(name));
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let prop = new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']);
        let pos = await this._player.call('org.freedesktop.DBus.Properties.Get', prop, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0);
    }

    _closePlayer() {
        this._player?.disconnectObject(this);
        this._mpris?.disconnectObject(this);
        if(this._playerId) this._player.disconnectSignal(this._playerId), this._playerId = 0;
        this._player = this._mpris = this._app = null;
        this.emit('closed', true);
        if(this._dbus) this._onProxyReady();
    }

    _onMprisProxyReady() {
        this._mpris.connectObject('notify::g-name-owner', () => this._mpris?.g_name_owner || this._closePlayer(), this);
        if(!this._mpris?.g_name_owner) this._closePlayer();
    }

    _onPlayerProxyReady() {
        this.emit('closed', false);
        this._player.connectObject('g-properties-changed', this._propsChanged.bind(this), this);
        this._playerId = this._player.connectSignal('Seeked', (_p, _s, [pos]) => this.emit('seeked', pos)); // some bad mpris do not emit
        this._updateMetadata();
    }

    _updateMetadata() {
        let data = {};
        for(let prop in this._player?.Metadata) data[prop] = this._player.Metadata[prop].deepUnpack();
        // Validate according to the spec; some clients send buggy metadata:
        // https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (data['mpris:length'] ?? 0) / 1000,
            title = typeof data['xesam:title'] === 'string' ? data['xesam:title'] : '',
            album = typeof data['xesam:album'] === 'string' ? data['xesam:album'] : '',
            artist = data['xesam:artist']?.every?.(x => typeof x === 'string')
                ? data['xesam:artist'].flatMap(x => x.split('/')).filter(Boolean).sort() : [];
        if(title) this.emit('update', { title, artist, album }, length);
    }

    get status() {
        return this._player?.PlaybackStatus ?? 'Stopped';
    }

    _propsChanged(_p, changed) {
        for(let name in changed.deepUnpack()) {
            if(name === 'Metadata') this._updateMetadata();
            else if(name === 'PlaybackStatus') this.emit('status', this.status);
        }
    }

    destroy() {
        this._dbus = null;
        this._closePlayer();
    }
};
