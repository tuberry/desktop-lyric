// vim:fdm=syntax
// by tuberry, from ui.mpris, add position
const Signals = imports.signals;
const ByteArray = imports.byteArray;
const { Shell, Gio, GLib, GObject, GMenu } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;

const AppSys = Shell.AppSystem.get_default();
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
        'update': { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_INT64] },
        'paused': { param_types: [GObject.TYPE_BOOLEAN] },
        'seeked': { param_types: [GObject.TYPE_INT64] },
        'closed': { },
    },
}, class MprisPlayer extends GObject.Object {
    _init() {
        super._init();
        this._getMultimedia();
        this._proxy = new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this._onProxyReady.bind(this));
    }

    _getAppId(busName) {
        try {
            const [pid] = this._proxy.call_sync('GetConnectionUnixProcessID', new GLib.Variant('(s)', [busName]), Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
            // const [ok, content] = GLib.file_get_contents('/proc/%d/cmdline'.format(pid)); // NOTE: not suitable for NUL, eg. lollypop and gnome-music
            const [ok, out] = GLib.spawn_command_line_sync('bash -c \'tr "\\0" " " </proc/%d/cmdline\''.format(pid));
            if(!ok) return '';
            let [cmd] = GLib.basename(ByteArray.toString(out)).split(' ');
            let [app] = Shell.AppSystem.search(cmd).toString().split(',');
            return app;
        } catch(e) {
            return '';
        }
    }

    _getMusicApps() {
        return Shell.AppSystem.search('music').toString().split(',');
    }

    _getMultimedia() {
        // Ref: https://gitlab.gnome.org/GNOME/gnome-shell-extensions/-/blob/master/extensions/apps-menu/extension.js
        this._tree = new GMenu.Tree({ menu_basename: 'applications.menu' });
        this._treeChangedId = this._tree.connect('changed', this._onTreeChanged.bind(this));
        this._installedChangedId = AppSys.connect('installed-changed', this._onTreeChanged.bind(this));
        this._onTreeChanged();
    }

    _onTreeChanged() {
        this.apps = [];
        this._tree.load_sync();
        let root = this._tree.get_root_directory();
        let iter = root.iter();
        let nextType;
        while((nextType = iter.next()) !== GMenu.TreeItemType.INVALID) {
            if(nextType !== GMenu.TreeItemType.DIRECTORY) continue;
            let dir = iter.get_directory();
            if(dir.get_is_nodisplay()) continue;
            let categoryId = dir.get_menu_id();
            if(categoryId != 'Multimedia') continue;
            this._loadCategory(categoryId, dir);
            break;
        }
    }

    _loadCategory(categoryId, dir) {
        let iter = dir.iter();
        let nextType;
        while((nextType = iter.next()) !== GMenu.TreeItemType.INVALID) {
            if(nextType === GMenu.TreeItemType.ENTRY) {
                try {
                    let entry = iter.get_entry();
                    let id = entry.get_desktop_file_id(); // catch non-UTF8 filenames
                    this.apps.push(id);
                } catch (e) {
                    continue;
                }
            } else if(nextType === GMenu.TreeItemType.SEPARATOR) {
                continue;
            } else if(nextType === GMenu.TreeItemType.DIRECTORY) {
                let subdir = iter.get_directory();
                if(!subdir.get_is_nodisplay()) this._loadCategory(categoryId, subdir);
            }
        }
    }

    _setPlayer(busName) {
        if(this._busName || !busName.startsWith(MPRIS_PLAYER_PREFIX)) return;
        if(!this.apps.includes(this._getAppId(busName))) return;

        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2', this._onMprisProxyReady.bind(this));
        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName, '/org/mpris/MediaPlayer2', this._onPlayerProxyReady.bind(this));

        this._trackTitle = '';
        this._trackArtists = '';
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
        if (newOwner && !oldOwner) this._setPlayer(name);
    }

    get position() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        try {
            const [pos] = this._playerProxy.call_sync(
                'org.freedesktop.DBus.Properties.Get',
                new GLib.Variant('(ss)', [
                    'org.mpris.MediaPlayer2.Player',
                    'Position',
                ]),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            ).recursiveUnpack();

            return pos;
        } catch (e) {
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
            this._playerProxy = null;

            this._mprisProxy.disconnect(this._ownerNotifyId);
            this._mprisProxy = null;
            this._busName = '';
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
        for (let prop in this._playerProxy.Metadata)
            metadata[prop] = this._playerProxy.Metadata[prop].deepUnpack();

        // Validate according to the spec; some clients send buggy metadata:
        // https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let artists = metadata['xesam:artist'];
        if(!Array.isArray(artists) || !artists.every(artist => typeof artist === 'string')) {
            this._trackArtists = '';
        } else {
            this._trackArtists = artists.join('/');
        }

        this._trackTitle = metadata['xesam:title'];
        if(typeof this._trackTitle !== 'string') this._trackTitle = '';

        this._trackLength = metadata['mpris:length'];
        if(typeof this._trackLength === 'undefined') this._trackLength = 0;

        if(this._trackTitle) this.emit('update', this._trackTitle, this._trackArtists, this._trackLength);
    }

    _updateState(proxy, changed, invalidated) {
        this.freeze_notify();
        for(let name in changed.deepUnpack()) {
            if(name == 'Metadata') {
                this._getMetadata();
            } else if(name == 'PlaybackStatus') {
                this.emit('paused', this.status != 'Playing');
            }
        }
        this.thaw_notify();
    }

    destroy() {
        this._close();
        this._tree = null;
        AppSys.disconnect(this._installedChangedId);
        this._proxy.disconnectSignal(this._nameChangedId);
        this._proxy = null;
    }
});

