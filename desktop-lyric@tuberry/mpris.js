// vim:fdm=syntax
// by tuberry
/* exported MprisPlayer */
'use strict';

const { Shell, Gio, GLib } = imports.gi;
const { EventEmitter } = imports.misc.signals;
const { loadInterfaceXML } = imports.misc.fileUtils;

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
        this._bus_proxy = new DbusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this._onProxyReady.bind(this));
    }

    _isMusicApp(bus_name) {
        if(!bus_name.startsWith(MPRIS_PLAYER_PREFIX)) return false;
        let name = bus_name.replace(new RegExp(`^${MPRIS_PLAYER_PREFIX}`), '');
        let [app] = Shell.AppSystem.search(name).toString().split(',');
        try {
            let cate = Shell.AppSystem.get_default().lookup_app(app || `${name}.desktop`).get_app_info().get_string('Categories').split(';');
            return cate.includes('AudioVideo') && !cate.includes('Video');
        } catch(e) {
            return false;
        }
    }

    _setPlayer(bus_name) {
        if(this._bus_name || !this._isMusicApp(bus_name)) return;
        this._bus_name = bus_name;
        let MprisProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2'));
        this._mpris_proxy = new MprisProxy(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2', this._onMprisProxyReady.bind(this));
        let PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);
        this._player_proxy = new PlayerProxy(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2', this._onPlayerProxyReady.bind(this));
    }

    _onProxyReady() {
        this._bus_proxy.ListNamesRemote(([names]) => names?.length && names.forEach(name => this._setPlayer(name)));
        this._bus_proxy.connectSignal('NameOwnerChanged', (proxy, sender, [name, old, mew]) => (mew && !old) && this._setPlayer(name));
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let prop = new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']);
        let pos = await this._player_proxy.call('org.freedesktop.DBus.Properties.Get', prop, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0);
    }

    _closePlayer() {
        this._player_proxy = this._mpris_proxy = this._bus_name = null;
        if(this._bus_proxy) this._onProxyReady();
        this.emit('closed');
    }

    _onMprisProxyReady() {
        this._mpris_proxy.connectObject('notify::g-name-owner', () => this._mpris_proxy?.g_name_owner || this._closePlayer(), this);
        if(!this._mpris_proxy?.g_name_owner) this._closePlayer();
    }

    _onPlayerProxyReady() {
        this._player_proxy.connectObject('g-properties-changed', this._propsChanged.bind(this), this);
        this._player_proxy.connectSignal('Seeked', (proxy, sender, [pos]) => this.emit('seeked', pos)); // some bad mpris do not emit
        this._updateMetadata();
    }

    _updateMetadata() {
        let meta = {};
        for(let prop in this._player_proxy?.Metadata) meta[prop] = this._player_proxy.Metadata[prop].deepUnpack();
        // Validate according to the spec; some clients send buggy metadata:
        // https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (meta['mpris:length'] ?? 0) / 1000;
        let title = typeof meta['xesam:title'] === 'string' ? meta['xesam:title'] : '';
        let album = typeof meta['xesam:album'] === 'string' ? meta['xesam:album'] : '';
        let artist = meta['xesam:artist']?.every?.(x => typeof x === 'string')
            ? meta['xesam:artist'].flatMap(x => x.split('/')).filter(Boolean).sort() : [];
        if(title) this.emit('update', { title, artist, album, length });
    }

    get status() {
        return this._player_proxy?.PlaybackStatus ?? 'Stopped';
    }

    _propsChanged(proxy, changed) {
        for(let name in changed.deepUnpack()) {
            if(name === 'Metadata') this._updateMetadata();
            else if(name === 'PlaybackStatus') this.emit('status', this.status);
        }
    }

    destroy() {
        this._bus_proxy = null;
        this._closePlayer();
    }
};
