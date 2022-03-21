// vim:fdm=syntax
// by tuberry
/* exported MprisPlayer */
'use strict';

const { Shell, Gio, GLib, GObject } = imports.gi;
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

var MprisPlayer = class extends GObject.Object {
    static {
        GObject.registerClass({
            Signals: {
                update: { param_types: [GObject.TYPE_STRING, GObject.TYPE_JSOBJECT, GObject.TYPE_INT64] },
                status: { param_types: [GObject.TYPE_STRING] },
                seeked: { param_types: [GObject.TYPE_INT64] },
                closed: { },
            },
        }, this);
    }

    constructor() {
        super();
        let DbusProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.DBus'));
        this._bus_proxy = new DbusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this._onProxyReady.bind(this));
    }

    async _checkMusicApp(bus_name) {
        let cmd = bus_name.replace(new RegExp(`^${MPRIS_PLAYER_PREFIX}`), '');
        let [app] = Shell.AppSystem.search(cmd).toString().split(',');
        if(!app) { // NOTE: for some bad mpris
            let pid = await this._bus_proxy.call('GetConnectionUnixProcessID', new GLib.Variant('(s)', [bus_name]), Gio.DBusCallFlags.NONE, -1, null);
            let [contents] = await Gio.File.new_for_path(`/proc/${pid.deepUnpack().at(0)}/cmdline`).load_contents_async(null);
            contents = contents.map(c => c === '\0' || c === '\n' ? new TextEncoder().encode(' ') : c);
            [cmd] = GLib.basename(new TextDecoder().decode(contents)).split(' ');
            [app] = Shell.AppSystem.search(cmd).toString().split(',');
        }
        let cate = Shell.AppSystem.get_default().lookup_app(app).get_app_info().get_string('Categories').split(';');
        return cate.includes('AudioVideo') && !cate.includes('Video');
    }

    _setPlayer(bus_name) {
        if(this._bus_name || !bus_name.startsWith(MPRIS_PLAYER_PREFIX)) return;
        this._checkMusicApp(bus_name).then(scc => {
            if(!scc) return;
            this._track_title = '';
            this._track_artists = [];
            this._track_length = 0;
            this._bus_name = bus_name;
            let MprisProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.mpris.MediaPlayer2'));
            this._mpris_proxy = new MprisProxy(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2', this._onMprisProxyReady.bind(this));
            let PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);
            this._player_proxy = new PlayerProxy(Gio.DBus.session, bus_name, '/org/mpris/MediaPlayer2', this._onPlayerProxyReady.bind(this));
        }).catch(noop);
    }

    _onProxyReady() {
        this._bus_proxy.ListNamesRemote(([names]) => names?.length && names.forEach(name => this._setPlayer(name)));
        this._bus_proxy.connectSignal('NameOwnerChanged', (proxy, sender, [name, old_, new_]) => (new_ && !old_) && this._setPlayer(name));
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
        this._mpris_proxy.connect('notify::g-name-owner', () => this._mpris_proxy?.g_name_owner || this._closePlayer());
        if(!this._mpris_proxy?.g_name_owner) this._closePlayer();
    }

    _onPlayerProxyReady() {
        this._player_proxy.connect('g-properties-changed', this._propsChanged.bind(this));
        this._player_proxy.connectSignal('Seeked', (proxy, sender, [pos]) => this.emit('seeked', pos));
        this._updateMetadata();
    }

    _updateMetadata() {
        let metadata = {};
        for(let prop in this._player_proxy?.Metadata) metadata[prop] = this._player_proxy.Metadata[prop].deepUnpack();
        let title = metadata['xesam:title'];
        let artists = metadata['xesam:artist'];
        // Validate according to the spec; some clients send buggy metadata:
        // https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        this._track_length = metadata['mpris:length'] || 0;
        this._track_title = typeof title === 'string' ? title : '';
        this._track_artists = Array.isArray(artists) && artists.every(a => typeof a === 'string') ? artists : [];
        if(this._track_title) this.emit('update', this._track_title, this._track_artists, this._track_length / 1000);
    }

    get status() {
        return this._player_proxy?.PlaybackStatus;
    }

    _propsChanged(proxy, changed, _invalidated) {
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

