// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const { GLib, St, Gio, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const gsettings = ExtensionUtils.getSettings();
const _ = ExtensionUtils.gettext;
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;
const Mpris = Me.imports.mpris;
const Lyric = Me.imports.lyric;
const Paper = Me.imports.paper;
const LYRIC_ICON = Me.dir.get_child('icons').get_child('lyric-symbolic.svg').get_path();

const DesktopLyric = GObject.registerClass({
    Properties: {
        'drag':     GObject.ParamSpec.boolean('drag', 'drag', 'drag', GObject.ParamFlags.READWRITE, false),
        'location': GObject.ParamSpec.string('location', 'location', 'location', GObject.ParamFlags.READWRITE, ''),
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
        this.bind_property('location', this._lyric, 'location', GObject.BindingFlags.GET);
        this._mpris.connect('update', this._update.bind(this));
        this._mpris.connect('closed', () => { this.status = 'Stopped'; });
        this._mpris.connect('status', (player, status) => { this.status = status; });
        this._mpris.connect('seeked', (player, position) => { this.position = position / 1000; });
        gsettings.bind(Fields.DRAG,     this, 'drag',     Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.INTERVAL, this, 'interval', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.SYSTRAY,  this, 'systray',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.LOCATION, this, 'location', Gio.SettingsBindFlags.GET);
    }

    set drag(drag) {
        this._drag = drag;
        if(this._button) this._updateMenu();
    }

    set interval(interval) {
        this._interval = interval;
        if(this._refreshId) this.playing = true;
    }

    set playing(play) {
        if(!this._hideItem?.state && this._paper.hide) this._paper.hide = false;
        if(this._refreshId) GLib.source_remove(this._refreshId);
        this._refreshId = play ? GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._interval, () => {
            this.position += this._interval + 1; // the error: 1ms;
            // log(this.position - this.Position);
            return GLib.SOURCE_CONTINUE;
        }) : undefined;
    }

    set status(status) {
        this.playing = status === 'Playing';
        if(status === 'Stopped') this._paper.clear();
        if(status === 'Paused') this._paper.hide = true;
    }

    get Position() {
        return this._mpris ? this._mpris.position / 1000 : 0;
    }

    _update(player, title, artists, length) {
        if(!this._lyric) return;
        this._lyric.find(title, artists, text => {
            if(text) {
                this._paper.length = length;
                this.position = (pos => length - pos > 800 || length === 0 ? pos : 50)(this.Position + 50); // some buggy mpris
                this._paper.text = text || '';
                this.playing = this._mpris.status === 'Playing';
            } else {
                this._paper.clear();
                this.playing = false;
            }
        });
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new PanelMenu.Button(0.0, null, false);
            this._button.add_actor(new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(LYRIC_ICON) }),
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
        this._button.menu.addMenuItem((this._hideItem = this._menuSwitchMaker(_('Hide lyric'), this._paper.hide, () => { this._paper.hide = !this._paper.hide; })));
        this._button.menu.addMenuItem(this._menuSwitchMaker(_('Unlock position'), this._drag, () => { this._button.menu.close(); gsettings.set_boolean(Fields.DRAG, !this._drag); }));
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addMenuItem(this._menuItemMaker(_('Resynchronize'), () => { this.position = this.Position + 50; }));
        this._button.menu.addMenuItem(this._menuItemMaker(_('0.5s Slower'), () => { this._paper.slower(); }));
        this._button.menu.addMenuItem(this._menuItemMaker(_('0.5s Faster'), () => { this._paper.faster(); }));
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addMenuItem(this._menuItemMaker(_('Settings'), () => { ExtensionUtils.openPrefs(); }));
    }

    _menuSwitchMaker(text, active, callback) {
        let item = new PopupMenu.PopupSwitchMenuItem(text, active, { style_class: 'desktop-lyric-item popup-menu-item' });
        item.connect('activate', callback);

        return item;
    }

    _menuItemMaker(text, callback) {
        let item = new PopupMenu.PopupMenuItem(text, { style_class: 'desktop-lyric-item popup-menu-item' });
        item.connect('activate', callback);

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
        this._ext = new DesktopLyric();
    }

    disable() {
        this._ext.destroy();
        delete this._ext;
    }
}

function init() {
    return new Extension();
}

