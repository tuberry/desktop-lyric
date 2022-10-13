// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const { St, Gio, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;
const Me = ExtensionUtils.getCurrentExtension();
const { Fields } = Me.imports.fields;
const Mpris = Me.imports.mpris;
const Lyric = Me.imports.lyric;
const Paper = Me.imports.paper;

const genIcon = x => Gio.Icon.new_for_string(Me.dir.get_child('icons').get_child(`${x}-symbolic.svg`).get_path());
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

class Field {
    constructor(prop, gset, obj) {
        this.gset = typeof gset === 'string' ? new Gio.Settings({ schema: gset }) : gset;
        this.prop = prop;
        this.bind(obj);
    }

    _get(x) {
        return this.gset[`get_${this.prop[x][1]}`](this.prop[x][0]);
    }

    _set(x, y) {
        this.gset[`set_${this.prop[x][1]}`](this.prop[x][0], y);
    }

    bind(a) {
        let fs = Object.entries(this.prop);
        fs.forEach(([x]) => { a[x] = this._get(x); });
        this.gset.connectObject(...fs.flatMap(([x, [y]]) => [`changed::${y}`, () => { a[x] = this._get(x); }]), a);
    }

    unbind(a) {
        this.gset.disconnectObject(a);
    }
}

class SwitchItem extends PopupMenu.PopupSwitchMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, active, callback, params) {
        super(text, active, params);
        this.connect('toggled', (x, y) => callback(y));
    }
}

class MenuItem extends PopupMenu.PopupMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, callback, params) {
        super(text, params);
        this.connect('activate', callback);
    }

    setLabel(label) {
        if(this.label.text !== label) this.label.set_text(label);
    }
}

class DesktopLyric extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                location: genParam('string', 'location', ''),
                position: genParam('int64', 'position', 0, Number.MAX_SAFE_INTEGER, 0),
            },
        }, this);
    }

    constructor() {
        super();
        this._lyric = new Lyric.Lyric();
        this.gset = ExtensionUtils.getSettings();
        this._paper = new Paper.Paper(this.gset);
        this._mpris = new Mpris.MprisPlayer();
        this.bind_property('position', this._paper, 'position', GObject.BindingFlags.DEFAULT);
        this.bind_property('location', this._lyric, 'location', GObject.BindingFlags.DEFAULT);
        this._mpris.connectObject('update', this._update.bind(this),
            'closed', () => (this.status = 'Stopped'),
            'status', (player, status) => (this.status = status),
            'seeked', (player, position) => (this.position = position / 1000), this);
        Main.overview.connectObject('showing', () => (this.view = true), 'hidden', () => (this.view = false), this);
        this._field = new Field({
            drag:     [Fields.DRAG,     'boolean'],
            location: [Fields.LOCATION, 'string'],
            systray:  [Fields.SYSTRAY,  'boolean'],
            interval: [Fields.INTERVAL, 'uint'],
        }, this.gset, this);
    }

    set view(view) {
        this._view = view;
        this._updateViz();
    }

    get hide() {
        return this.status !== 'Playing' || this._view || this._menus?.hide.state;
    }

    set drag(drag) {
        this._drag = drag;
        this._menus?.unlock.setToggleState(drag);
    }

    set interval(interval) {
        this._interval = interval;
        if(this._refreshId) this.playing = true;
    }

    set playing(playing) {
        this._updateViz();
        clearInterval(this._refreshId);
        if(playing) this._refreshId = setInterval(() => (this.position += this._interval + 1), this._interval);
    }

    get status() {
        return this._status ?? this._mpris.status;
    }

    set status(status) {
        this._status = status;
        this.playing = status === 'Playing';
    }

    _syncPosition(callback) {
        this._mpris.getPosition().then(scc => (this.position = callback(scc / 1000))).catch(() => (this.position = 0));
    }

    async _update(player, title, artists, length) {
        if(this._title === title && JSON.stringify(this._artists) === JSON.stringify(artists)) {
            this._syncPosition(x => length - x > 5000 || !length ? x : 50);
        } else {
            this._title = title;
            this._artists = artists;
            try {
                this.setLyric(await this._lyric.find(title, artists), length);
            } catch(e) {
                this.clearLyric();
            }
        }
    }

    async reload() {
        try {
            this.setLyric(await this._lyric.fetch(this._title, this._artists), this._paper.length);
        } catch(e) {
            this.clearLyric();
        }
    }

    setLyric(text, length) {
        this._paper.text = text;
        this._paper.length = length;
        this._syncPosition(x => length - x > 5000 || !length ? x : 50); // some buggy mpris
        this.playing = this._mpris.status === 'Playing';
    }

    clearLyric() {
        this.playing = false;
        this._paper.text = '';
        this._paper._area.queue_repaint();
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new PanelMenu.Button(0.5);
            this._button.menu.actor.add_style_class_name('app-menu');
            this._button.add_actor(new St.Icon({ gicon: genIcon('lyric'), style_class: 'desktop-lyric-systray system-status-icon' }));
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button);
            this._addMenuItems();
        } else {
            if(!this._button) return;
            this._button.destroy();
            this._menus = this._button = null;
        }
    }

    _updateViz() {
        if(!this._paper || this._paper.hide ^ !this.hide) return;
        this._paper.hide = !this._paper.hide;
    }

    _addMenuItems() {
        this._menus = {
            hide:     new SwitchItem(_('Hide lyric'), this._paper.hide, this._updateViz.bind(this)),
            unlock:   new SwitchItem(_('Unlock position'), this._drag, () => { this._button.menu.close(); this._field._set('drag', !this._drag); }),
            resync:   new MenuItem(_('Resynchronize'), () => this._syncPosition(x => x + 50)),
            reload:   new MenuItem(_('Redownload'), () => this.reload()),
            sep:      new PopupMenu.PopupSeparatorMenuItem(),
            settings: new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this._button.menu.addMenuItem(this._menus[p]);
    }

    destroy() {
        this._field.unbind(this);
        this.playing = this.systray = null;
        Main.overview.disconnectObject(this);
        ['_mpris', '_lyric', '_paper'].forEach(x => { this[x].destroy(); this[x] = null; });
    }
}

class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._ext = new DesktopLyric();
    }

    disable() {
        this._ext.destroy();
        this._ext = null;
    }
}

function init() {
    return new Extension();
}
