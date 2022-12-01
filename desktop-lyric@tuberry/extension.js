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
const { Fields, Field } = Me.imports.fields;
const { Lyric } = Me.imports.lyric;
const { MprisPlayer } = Me.imports.mpris;
const { DesktopPaper, PanelPaper } = Me.imports.paper;

const genIcon = x => Gio.Icon.new_for_string(Me.dir.get_child('icons').get_child(`${x}.svg`).get_path());

class SwitchItem extends PopupMenu.PopupSwitchMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, active, callback, params) {
        super(text, active, params);
        this.connect('toggled', (_x, y) => callback(y));
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

    constructor(callback) {
        super(0.5, Me.metadata.uuid);
        this._xbutton_cb = callback;
        this.menu.actor.add_style_class_name('app-menu');
        this._box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._box.add_actor(new St.Icon({ gicon: genIcon('lyric-symbolic'), style_class: 'system-status-icon' }));
        this.add_actor(this._box);
    }

    set_paper(paper) {
        if(paper) this._box.add_actor(paper);
    }

    vfunc_event(event) {
        if(event.type() === Clutter.EventType.BUTTON_PRESS && (event.get_button() === 8 || event.get_button() === 9)) {
            this._xbutton_cb();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }
}

class DesktopLyric {
    constructor() {
        this._lyric = new Lyric();
        this._mpris = new MprisPlayer();
        this._bindSettings();
        Main.overview.connectObject('showing', () => (this.view = true),
            'hiding', () => (this.view = false), this);
        this._mpris.connectObject('update', this._update.bind(this),
            'closed', () => (this.status = 'Stopped'),
            'status', (_p, status) => (this.status = status),
            'seeked', (_p, position) => this.setPosition(position / 1000), this);
    }

    _bindSettings() {
        this._field = new Field({}, ExtensionUtils.getSettings(), this);
        this._field.attach({
            mini:     [Fields.MINI,     'boolean'],
            drag:     [Fields.DRAG,     'boolean'],
            index:    [Fields.INDEX,    'uint'],
            location: [Fields.LOCATION, 'string'],
            interval: [Fields.INTERVAL, 'uint'],
        }, this);
    }

    set location(location) {
        this._lyric.location = location;
    }

    set mini(mini) {
        this._mini = mini;
        if(this._paper) {
            this.playing = false;
            this._paper.destroy();
            this._paper = null;
        }
        if(mini) {
            this._paper = new PanelPaper(this._field);
            this._button?.set_paper(this._paper);
            this._menus?.drag.hide();
        } else {
            this._paper = new DesktopPaper(this._field);
            this._menus?.drag.show();
        }
        if(this._song) this.loadLyric();
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new LyricButton(() => this.syncPosition(x => x + 50));
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button, this._index ? 0 : 5, ['left', 'center', 'right'][this._index ?? 0]);
            this._addMenuItems();
            if(this._mini) this.mini = this._mini;
        } else {
            if(!this._button) return;
            this._button.destroy();
            this._menus = this._button = null;
            if(this._mini) this._paper = null;
        }
    }

    set index(index) {
        if(this._index === index) return;
        this._index = index;
        this.systray = false;
        this.systray = true;
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
        if(playing && this._paper) this._refreshId = setInterval(() => this.setPosition(this._paper._moment + this._interval + 1), this._interval);
    }

    get status() {
        return this._status ?? this._mpris.status;
    }

    set status(status) {
        this._status = status;
        this.playing = status === 'Playing';
    }

    syncPosition(cb) {
        this._mpris.getPosition().then(scc => this.setPosition(cb(scc / 1000))).catch(() => this.setPosition(0));
    }

    _update(_player, song, length) {
        if(JSON.stringify(song) === JSON.stringify(this._song)) {
            this.syncPosition(x => length - x > 5000 || !length ? x : 50);
        } else {
            this._length = length;
            this._song = song;
            this.loadLyric();
        }
    }

    setPosition(pos) {
        this._paper.moment = pos;
    }

    async loadLyric() {
        try {
            this.setLyric(await this._lyric.find(this._song));
        } catch(e) {
            this.clearLyric();
        }
    }

    async reloadLyric() {
        try {
            this.setLyric(await this._lyric.fetch(this._song));
        } catch(e) {
            logError(e);
            this.clearLyric();
            this._lyric.delete(this._song);
        }
    }

    setLyric(text) {
        if(!this._paper) return;
        let span = this._length ?? 0;
        this._paper.span = span;
        this._paper.text = text;
        this.syncPosition(x => span - x > 5000 || !span ? x : 50); // some buggy mpris
        this.playing = this._mpris.status === 'Playing';
    }

    clearLyric() {
        this.playing = false;
        if(!this._paper) return;
        this._paper.text = '';
        this._paper.queue_repaint();
    }

    _updateViz() {
        let viz = this.status === 'Playing' && !this._menus?.hide.state && !(this._view && !this._mini);
        if(this._paper && this._paper.visible ^ viz) this._paper.visible = !this._paper.visible;
    }

    _addMenuItems() {
        this._menus = {
            hide:   new SwitchItem(_('Invisiblize'), false, () => this._updateViz()),
            mini:   new SwitchItem(_('Minimize'), this._mini, () => this.setf('mini', !this._mini)),
            drag:   new SwitchItem(_('Mobilize'), this._drag, () => this.setf('drag', !this._drag)),
            sep0:   new PopupMenu.PopupSeparatorMenuItem(),
            reload: new MenuItem(_('Redownload'), () => this.reloadLyric()),
            resync: new MenuItem(_('Resynchronize'), () => this.syncPosition(x => x + 50)),
            sep1:   new PopupMenu.PopupSeparatorMenuItem(),
            prefs:  new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this._button.menu.addMenuItem(this._menus[p]);
    }

    destroy() {
        this._field.detach(this);
        this.systray = this.playing = null;
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
