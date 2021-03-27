// vim: fdm=syntax
// by tuberry
const Cairo = imports.cairo;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const { PangoCairo, Pango, Soup, GLib, Clutter, St, Gio, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const gsettings = ExtensionUtils.getSettings();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.prefs.Fields;

const Mpris = Me.imports.mpris;
const Lyric = Me.imports.lyric;
const Paper = Me.imports.paper;

const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const getIcon = x => Me.dir.get_child('icons').get_child(x + '-symbolic.svg').get_path();

const DesktopLyric = GObject.registerClass({
    Properties: {
        'drag':     GObject.ParamSpec.boolean('drag', 'drag', 'drag', GObject.ParamFlags.READWRITE, false),
        'systray':  GObject.ParamSpec.boolean('systray', 'systray', 'systray', GObject.ParamFlags.READWRITE, false),
        'interval': GObject.ParamSpec.uint('interval', 'interval', 'interval', GObject.ParamFlags.READWRITE, 50, 500, 60),
        'position': GObject.ParamSpec.int64('position', 'position', 'position', GObject.ParamFlags.READWRITE, 0, Number.MAX_SAFE_INTEGER, 0),
    },
}, class DesktopLyric extends GObject.Object {
    _init() {
        super._init();

        this._lyric = new Lyric.Lyric();
        this._paper = new Paper.Paper();
        this._mpris = new Mpris.MprisPlayer();

        this.bind_property('position', this._paper, 'position', GObject.BindingFlags.GET);
        this._mpris.connect('update', this._update.bind(this));
        this._mpris.connect('paused', (player, paused) => { this.playing = !paused; });
        this._mpris.connect('seeked', (player, position) => { this.position = position / 1000; });
        this._mpris.connect('closed', () => { this.playing = false; this._paper.clear(); });
        gsettings.bind(Fields.DRAG,     this, 'drag',     Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.INTERVAL, this, 'interval', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.SYSTRAY,  this, 'systray',  Gio.SettingsBindFlags.GET);
    }

    set drag(drag) {
        this._drag = drag;
        if(!this._button) return;
        this._updateMenu();
    }

    set interval(interval) {
        this._interval = interval;
        if(this._refreshId) this.playing = true;
    }

    set playing(play) {
        if(this._refreshId) GLib.source_remove(this._refreshId);
        this._refreshId = play ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._interval, () => {
            this.position += this._interval + 1; // the error: 1ms;
            // log(this.position - this.Position);
            return GLib.SOURCE_CONTINUE;
        }) : 0;
    }

    get Position() {
        return this._mpris ? this._mpris.position / 1000 : 0;
    }

    _update(player, title, artist, length) {
        this._lyric.find(title, artist, text => {
            this._paper.length = length / 1000;
            this._paper.text = text;
            this.position = this.Position + 50; // the error: 50ms;
            this.playing = (this._mpris.status == 'Playing') && text;
        });
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new PanelMenu.Button(0.0, null, false);
            this._button.add_actor(new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(getIcon('lyric')) }),
                style_class: 'desktop-lyric-systray system-status-icon',
            }));
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button, 0, 'right');
            this._updateMenu();
        } else {
            if(!this._button) return;
            this._button.destroy();
            delete this._button;
        }
    }

    _updateMenu() {
        if(!this._button) return;
        this._button.menu.removeAll();
        this._button.menu.addMenuItem(this._menuItemMaker(item => {
            item._getTopMenu().close(); gsettings.set_boolean(Fields.DRAG, !this._drag);
        }, this._drag ? _('Lock position') : _('Unlock position')));
        this._button.menu.addMenuItem(this._menuItemMaker(() => { this._paper.slower(); }, _('Slower 0.5s')));
        this._button.menu.addMenuItem(this._menuItemMaker(() => { this._paper.faster(); }, _('Faster 0.5s')));
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addMenuItem(this._menuItemMaker(item => { ExtensionUtils.openPrefs() }, _('Settings')));
    }

    _menuItemMaker(callback, text) {
        let item = new PopupMenu.PopupBaseMenuItem({ style_class: 'desktop-lyric-item popup-menu-item' });
        item.connect('activate', callback);
        item.add_child(new St.Label({ x_expand: true, text: text }));

        return item;
    }

    destroy() {
        this.playing = false;
        this.systray = false;
        this._mpris.destroy();
        this._lyric.destroy();
        this._paper.destroy();
        delete this._mpris;
        delete this._lyric;
        delete this._paper;
    }
});

class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._lyric = new DesktopLyric();
    }

    disable() {
        this._lyric.destroy();
        delete this._lyric;
    }
}

function init() {
    return new Extension();
}

