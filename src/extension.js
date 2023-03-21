// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const { St, GObject, Clutter } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Fulu, Extension, DEventEmitter, symbiose, omit, onus } = Me.imports.fubar;
const { SwitchItem, MenuItem, TrayIcon } = Me.imports.menu;
const { DesktopPaper, PanelPaper } = Me.imports.paper;
const { _, id, xnor } = Me.imports.util;
const { MprisPlayer } = Me.imports.mpris;
const { Field } = Me.imports.const;
const { Lyric } = Me.imports.lyric;

class LyricButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(callback) {
        super(0.5, Me.metadata.uuid);
        this._xbutton_cb = callback;
        this.menu.actor.add_style_class_name('app-menu');
        this._box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._box.add_actor(new TrayIcon('lyric-symbolic', true));
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

class DesktopLyric extends DEventEmitter {
    constructor() {
        super();
        this._buildWidgets();
        this._bindSettings();
    }

    _buildWidgets() {
        this._lyric = new Lyric();
        this._mpris = new MprisPlayer();
        this._sbt = symbiose(this, () => omit(this, '_mpris', '_lyric', '_paper'), {
            sync: [x => clearTimeout(x), x => setTimeout(x, 500)],
            tray: [() => { this.systray = false; }, () => { this.systray = true; }],
            play: [x => clearInterval(x), x => x && setInterval(() => this.setPosition(this._paper._moment + this._span + 0.625), this._span)],
        });
    }

    _bindSettings() {
        this._fulu = new Fulu({}, ExtensionUtils.getSettings(), this);
        this._fulu.attach({
            mini:  [Field.MINI, 'boolean'],
            drag:  [Field.DRAG, 'boolean'],
            index: [Field.TIDX, 'uint'],
            path:  [Field.PATH, 'string'],
            span:  [Field.SPAN, 'uint'],
        }, this);
        this._mpris.connectObject('update', this._update.bind(this),
            'closed', (_p, closed) => { this.closed = closed; },
            'status', (_p, status) => { this.playing = status === 'Playing'; },
            'seeked', (_p, position) => this.setPosition(position / 1000), onus(this));
    }

    set path(path) {
        this._lyric.location = path;
    }

    set mini(mini) {
        this._mini = mini;
        if(this._paper) omit(this, 'playing', '_paper');
        if(mini) {
            this._paper = new PanelPaper(this._fulu);
            this._btn?.set_paper(this._paper);
            this._menus?.drag.hide();
        } else {
            this._paper = new DesktopPaper(this._fulu);
            this._menus?.drag.show();
        }
        if(this._song) this.loadLyric();
    }

    set systray(systray) {
        if(xnor(systray, this._btn)) return;
        if(systray) {
            this._btn = Main.panel.addToStatusArea(Me.metadata.uuid, new LyricButton(() => this.syncPosition()),
                this._index ? 0 : 5, ['left', 'center', 'right'][this._index ?? 0]);
            this._addMenuItems();
            this._btn.visible = this._showing;
            if(this._mini) this.mini = this._mini;
        } else {
            if(this._mini) omit(this, '_paper');
            omit(this, '_btn', '_menus');
        }
    }

    set index(index) {
        if(this._index === index) return;
        this._index = index;
        this._sbt.tray.revive();
        this.appMenuHidden = !index & this._showing;
    }

    set drag(drag) {
        this._drag = drag;
        this._menus?.drag.setToggleState(drag);
    }

    set span(span) {
        this._span = span;
        if(this._sbt.play._delegate) this.playing = true;
    }

    set playing(playing) {
        this._updateViz();
        this._sbt.play.revive(playing && this._paper);
    }

    set closed(closed) {
        this._showing = !closed;
        if(closed) this.clearLyric();
        if(this._btn) this._btn.visible = !closed;
        this.appMenuHidden = !this._index & !closed;
    }

    set appMenuHidden(appMenuHidden) {
        if(xnor(this._appMenuHidden, appMenuHidden)) return;
        if((this._appMenuHidden = appMenuHidden)) Main.panel.statusArea.appMenu.connectObject('changed', a => a[a._visible ? 'show' : 'hide'](), onus(this));
        else Main.panel.statusArea.appMenu.disconnectObject(onus(this));
    }

    async syncPosition() {
        if(this._syncing) return;
        this._syncing = true;
        let pos = await this._mpris.getPosition() / 1000;
        for(let i = 0; pos && (pos === this._pos || !this._length || this._length - pos < 500) && i < 7; i++) { // FIXME: workaround for stale positions from buggy NCM mpris when changing songs
            await new Promise(resolve => this._sbt.sync.revive(resolve));
            pos = await this._mpris.getPosition() / 1000;
        }
        this.setPosition((this._pos = pos) + 50);
        this._syncing = false;
    }

    _update(_player, song, length) {
        if(JSON.stringify(song) === JSON.stringify(this._song)) {
            this.syncPosition();
        } else {
            let { title, artist } = song;
            this._subject = [title, artist.join('/')].filter(id).join(' - ');
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
            this.setLyric(await this._lyric.find(this._song), this._song);
        } catch(e) {
            this.setLyric('');
        }
    }

    async reloadLyric() {
        try {
            this.setLyric(await this._lyric.find(this._song, true));
        } catch(e) {
            logError(e);
            this.setLyric('');
            this._lyric.delete(this._song);
        }
    }

    setLyric(text) {
        if(!this._paper) return;
        let span = this._length ?? 0;
        this._paper.span = span;
        this._paper.text = text;
        this._paper.song = this._mini ? this._subject : '';
        this.playing = this._mpris.status === 'Playing';
        this.syncPosition();
    }

    clearLyric() {
        this.playing = false;
        this._paper?.clear();
    }

    _updateViz() {
        let viz = this._mpris.status === 'Playing' && !this._menus?.hide.state;
        if(this._paper && this._paper.visible ^ viz) this._paper.visible = viz;
    }

    _addMenuItems() {
        this._menus = {
            hide:   new SwitchItem(_('Invisiblize'), false, () => this._updateViz()),
            mini:   new SwitchItem(_('Minimize'), this._mini, x => this._fulu.set('mini', x, this)),
            drag:   new SwitchItem(_('Mobilize'), this._drag, x => this._fulu.set('drag', x, this)),
            sep0:   new PopupMenu.PopupSeparatorMenuItem(),
            reload: new MenuItem(_('Redownload'), () => this.reloadLyric()),
            resync: new MenuItem(_('Resynchronize'), () => this.syncPosition()),
            sep1:   new PopupMenu.PopupSeparatorMenuItem(),
            prefs:  new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this._btn.menu.addMenuItem(this._menus[p]);
    }
}

function init() {
    return new Extension(DesktopLyric);
}
