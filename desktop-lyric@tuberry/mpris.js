// vim:fdm=syntax
// by tuberry
//
'use strict';
const Signals = imports.signals;
const ByteArray = imports.byteArray;
const { Shell, Gio, GLib, GObject } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;

const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

const MprisIface = loadInterfaceXML('org.mpris.MediaPlayer2');
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);

const MprisPlayerIface = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <signal name="Seeked">
      <arg type="x" direction="out" name="pos"/>
    </signal>
  </interface>
</node>
`;
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);
const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

var MprisPlayer = GObject.registerClass({
    Signals: {
        'update': { param_types: [GObject.TYPE_STRING, GObject.TYPE_JSOBJECT, GObject.TYPE_INT64] },
        'status': { param_types: [GObject.TYPE_STRING] },
        'seeked': { param_types: [GObject.TYPE_INT64] },
        'closed': { },
    },
}, class MprisPlayer extends GObject.Object {
    _init() {
        super._init();
        this._proxy = new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this._onProxyReady.bind(this));
    }

    _isMusicApp(busName) {
        try {
            let cmd = busName.replace(new RegExp('^' + MPRIS_PLAYER_PREFIX), ''); // NOTE: some bad mpris implements do not support this;
            let [app] = Shell.AppSystem.search(cmd).toString().split(',');
            if(!app) {
                let [pid] = this._proxy.call_sync('GetConnectionUnixProcessID', new GLib.Variant('(s)', [busName]), Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
                // let [ok, content] = GLib.file_get_contents('/proc/%d/cmdline'.format(pid)); // NOTE: not suitable for NUL (`python ...`), eg. lollypop and gnome-music
                let [ok, out] = GLib.spawn_command_line_sync('bash -c \'tr "\\0" " " </proc/%d/cmdline\''.format(pid));
                if(!ok) return false;
                [cmd] = GLib.basename(ByteArray.toString(out)).split(' ');
                [app] = Shell.AppSystem.search(cmd).toString().split(',');
            }
            let cate = Shell.AppSystem.get_default().lookup_app(app).get_app_info().get_string('Categories').split(';');
            return cate.includes('AudioVideo') && !cate.includes('Video');
        } catch(e) {
            return false;
        }
    }

    _setPlayer(busName) {
        if(this._busName || !busName.startsWith(MPRIS_PLAYER_PREFIX) || !this._isMusicApp(busName)) return;
        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2', this._onMprisProxyReady.bind(this));
        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2', this._onPlayerProxyReady.bind(this));

        this._trackTitle = '';
        this._trackArtists = [];
        this._trackLength = 0;
        this._busName = busName;
    }

    _onProxyReady() {
        this._proxy.ListNamesRemote(([names]) => {
            if(!names) return;
            names.forEach(name => { this._setPlayer(name); });
        });
        this._nameChangedId = this._proxy.connectSignal('NameOwnerChanged', this._onNameOwnerChanged.bind(this));
    }

    _onNameOwnerChanged(proxy, sender, [name, oldOwner, newOwner]) {
        if(newOwner && !oldOwner) this._setPlayer(name);
    }

    get position() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        try {
            let prop = new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position',]);
            let [pos] = this._playerProxy.call_sync('org.freedesktop.DBus.Properties.Get', prop, Gio.DBusCallFlags.NONE, -1, null).recursiveUnpack();
            return pos;
        } catch(e) {
            return 0;
        }
    }

    get status() {
        return this._playerProxy ? this._playerProxy.PlaybackStatus : '';
    }

    _close() {
        try {
            this._playerProxy.disconnect(this._propsChangedId);
            this._playerProxy.disconnectSignal(this._positChangedId);
            this._mprisProxy.disconnect(this._ownerNotifyId);
            delete this._playerProxy;
            delete this._mprisProxy;
            delete this._busName;
        } catch(e) {
            // Ignore DBus.NoReply Error when closing
        }
        if(this._proxy) this._onProxyReady();

        this.emit('closed');
    }

    _onMprisProxyReady() {
        this._ownerNotifyId = this._mprisProxy.connect('notify::g-name-owner', () => {
            if (!this._mprisProxy.g_name_owner) this._close();
        });
        if (!this._mprisProxy.g_name_owner) this._close();
    }

    _onPlayerProxyReady() {
        this._propsChangedId = this._playerProxy.connect('g-properties-changed', this._updateState.bind(this));
        this._positChangedId = this._playerProxy.connectSignal('Seeked', (proxy, sender, [pos]) => { this.emit('seeked', pos); });
        this._getMetadata();
    }

    _getMetadata() {
        let metadata = {};
        for(let prop in this._playerProxy.Metadata)
            metadata[prop] = this._playerProxy.Metadata[prop].deepUnpack();
        this._trackLength = metadata['mpris:length'] || 0;
        let title = metadata['xesam:title'];
        this._trackTitle = typeof title === 'string' ? title : '';
        // Validate according to the spec; some clients send buggy metadata:
        // https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let artists = metadata['xesam:artist'];
        this._trackArtists = Array.isArray(artists) && artists.every(a => typeof a === 'string') ? artists : [];
        if(this._trackTitle) this.emit('update', this._trackTitle, this._trackArtists, this._trackLength);
    }

    _updateState(proxy, changed, invalidated) {
        this.freeze_notify();
        for(let name in changed.deepUnpack()) {
            if(name == 'Metadata') {
                this._getMetadata();
            } else if(name == 'PlaybackStatus') {
                this.emit('status', this.status);
            }
        }
        this.thaw_notify();
    }

    destroy() {
        this._close();
        this._proxy.disconnectSignal(this._nameChangedId);
        delete this._proxy;
    }
});

