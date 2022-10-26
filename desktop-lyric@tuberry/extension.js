// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const { St, Gio, GObject, Clutter } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;
const Me = ExtensionUtils.getCurrentExtension();
const { Fields } = Me.imports.fields;
const Mpris = Me.imports.mpris;
const Lyric = Me.imports.lyric;
const { DesktopPaper, PanelPaper } = Me.imports.paper;

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

class LyricButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super(0.5, Me.metadata.uuid);
        this.menu.actor.add_style_class_name('app-menu');
        this._box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._box.add_actor(new St.Icon({ gicon: genIcon('lyric'), style_class: 'desktop-lyric-systray system-status-icon' }));
        this.add_actor(this._box);
    }

    set_paper(paper) {
        if(paper) this._box.add_actor(paper);
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
        this._mpris = new Mpris.MprisPlayer();
        this.bind_property('location', this._lyric, 'location', GObject.BindingFlags.DEFAULT);
        this._field = new Field({
            mini:     [Fields.MINI,     'boolean'],
            drag:     [Fields.DRAG,     'boolean'],
            systray:  [Fields.SYSTRAY,  'boolean'],
            location: [Fields.LOCATION, 'string'],
            interval: [Fields.INTERVAL, 'uint'],
        }, ExtensionUtils.getSettings(), this);
        Main.overview.connectObject('showing', () => (this.view = true), 'hidden', () => (this.view = false), this);
        this._mpris.connectObject('update', this._update.bind(this),
            'closed', () => (this.status = 'Stopped'),
            'status', (player, status) => (this.status = status),
            'seeked', (player, position) => (this.position = position / 1000), this);
    }

    set mini(mini) {
        if(this._mini === mini) return;
        this._mini = mini;
        if(this._paper) {
            this.playing = false;
            this._paper.destroy();
            this._paper = null;
        }
        if(mini) {
            this._paper = new PanelPaper(ExtensionUtils.getSettings());
            this._button?.set_paper(this._paper);
            this._menus?.drag.hide();
        } else {
            this._paper = new DesktopPaper(ExtensionUtils.getSettings());
            this._menus?.drag.show();
        }
        this.loadLyric();
        this.bind_property('position', this._paper, 'moment', GObject.BindingFlags.DEFAULT);
    }

    set view(view) {
        this._view = view;
        this._updateViz();
    }

    set drag(drag) {
        this._drag = drag;
        this._menus?.drag.setToggleState(drag);
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

    _update(player, title, artists, length) {
        if(this._title === title && JSON.stringify(this._artists) === JSON.stringify(artists)) {
            this._syncPosition(x => length - x > 5000 || !length ? x : 50);
        } else {
            this._title = title;
            this._artists = artists;
            this._length = length;
            this.loadLyric();
        }
    }

    async loadLyric() {
        try {
            this.setLyric(await this._lyric.find(this._title, this._artists));
        } catch(e) {
            this.clearLyric();
        }
    }

    async reloadLyric() {
        try {
            this.setLyric(await this._lyric.fetch(this._title, this._artists));
        } catch(e) {
            this.clearLyric();
        }
    }

    setLyric(text) {
        if(!this._paper) return;
        let span = this._length ?? 0;
        this._paper.span = span;
        this._paper.text = text;
        this._syncPosition(x => span - x > 5000 || !span ? x : 50); // some buggy mpris
        this.playing = this._mpris.status === 'Playing';
    }

    clearLyric() {
        this.playing = false;
        if(!this._paper) return;
        this._paper.text = '';
        this._paper.queue_repaint();
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new LyricButton();
            this._button.connect('button-press-event', (a, e) => e.get_button() === Clutter.BUTTON_MIDDLE && this._syncPosition(x => x + 50)),
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button, 2, 'left');
            this._addMenuItems();
        } else {
            if(!this._button) return;
            this._button.destroy();
            this._menus = this._button = null;
            if(this._mini) this._paper = null;
        }
    }

    get visible() {
        return this.status === 'Playing' && !this._menus?.hide.state && !(this._view && !this._mini);
    }

    _updateViz() {
        if(!this._paper || this._paper.visible === this.visible) return;
        this._paper.visible = !this._paper.visible;
    }

    _addMenuItems() {
        this._menus = {
            hide:     new SwitchItem(_('Invisiblize'), false, this._updateViz.bind(this)),
            mini:     new SwitchItem(_('Minimize'), this._mini, () => this._field._set('mini', !this._mini)),
            drag:     new SwitchItem(_('Mobilize'), this._drag, () => this._field._set('drag', !this._drag)),
            sep0:     new PopupMenu.PopupSeparatorMenuItem(),
            reload:   new MenuItem(_('Redownload'), () => this.reloadLyric()),
            resync:   new MenuItem(_('Resynchronize'), () => this._syncPosition(x => x + 50)),
            sep1:     new PopupMenu.PopupSeparatorMenuItem(),
            settings: new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this._button.menu.addMenuItem(this._menus[p]);
        if(!this._mini) return;
        this._button.set_paper(this._paper);
        this._menus.drag.hide();
    }

    destroy() {
        this._field.unbind(this);
        this.playing = this.systray = null;
        Main.overview.disconnectObject(this);
        ['_mpris', '_lyric', '_paper'].forEach(x => { this[x]?.destroy(); this[x] = null; });
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
