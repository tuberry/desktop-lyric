// vim:fdm=syntax
// by tuberry
/* exported MprisPlayer */
'use strict';

const { Shell, Gio, GLib } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { Symbiont, DEventEmitter } = Me.imports.fubar;
const { omap } = Me.imports.util;

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

var MprisPlayer = class extends DEventEmitter {
    constructor() {
        super();
        this._proxy = new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', () => this._onProxyReady());
        this._sbt_p = new Symbiont(x => x && this._player?.disconnectSignal(x), this,
            () => this._player?.connectSignal('Seeked', (_p, _s, [pos]) => this.emit('seeked', pos)));
        new Symbiont(() => { this._proxy = null; this._closePlayer(); }, this);
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
        this._mpris = new MprisProxy(Gio.DBus.session, app, '/org/mpris/MediaPlayer2', () => this._onMprisReady());
        this._player = new PlayerProxy(Gio.DBus.session, app, '/org/mpris/MediaPlayer2', () => this._onPlayerReady());
    }

    async _onProxyReady() {
        this._proxy.connectSignal('NameOwnerChanged', (_p, _s, [name, old, neo]) => { (neo && !old) && this._setPlayer(name); });
        let [names] = await this._proxy.ListNamesAsync();
        names.forEach(name => this._setPlayer(name));
    }

    async getPosition() {
        // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this._app, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0);
    }

    _closePlayer() {
        this._sbt_p.dispel();
        this._mpris?.disconnectObject(this);
        this._player?.disconnectObject(this);
        this._player = this._mpris = this._app = null;
        this.emit('closed', true);
        if(this._proxy) this._onProxyReady();
    }

    _onMprisReady() {
        this._mpris.connectObject('notify::g-name-owner', () => this._mpris.g_name_owner || this._closePlayer(), this);
        if(!this._mpris.g_name_owner) this._closePlayer();
    }

    _onPlayerReady() {
        this.emit('closed', false);
        this._sbt_p.reset();
        this._player.connectObject('g-properties-changed', this._propsChanged.bind(this), this);
        this._updateMetadata(omap(this._player?.Metadata ?? {}, ([k, v]) => [k, v.deepUnpack()]));
    }

    _updateMetadata(data) {
        // filter dirty data; https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        let length = (data['mpris:length'] ?? 0) / 1000,
            title = typeof data['xesam:title'] === 'string' ? data['xesam:title'] : '',
            album = typeof data['xesam:album'] === 'string' ? data['xesam:album'] : '',
            artist = data['xesam:artist']?.every?.(x => typeof x === 'string')
                ? data['xesam:artist'].flatMap(x => x.split('/')).filter(x => x).sort() : [];
        if(title) this.emit('update', { title, artist, album }, length);
    }

    get status() {
        return this._player?.PlaybackStatus ?? 'Stopped';
    }

    _propsChanged(_p, changed) {
        let props = changed.recursiveUnpack();
        if('Metadata' in props) this._updateMetadata(props.Metadata);
        if('PlaybackStatus' in props) this.emit('status', this.status);
    }
};
