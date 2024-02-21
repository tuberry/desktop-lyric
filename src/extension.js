// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Field} from './const.js';
import {Lyric} from './lyric.js';
import {Mpris} from './mpris.js';
import {xnor, noop, homolog, hook} from './util.js';
import {DesktopPaper, PanelPaper} from './paper.js';
import {SwitchItem, MenuItem, PanelButton} from './menu.js';
import {Fulu, ExtensionBase, Destroyable, symbiose, omit, getSelf, _} from './fubar.js';

class DesktopLyric extends Destroyable {
    constructor(gset) {
        super();
        this._buildWidgets(gset);
        this._bindSettings();
    }

    _buildWidgets(gset) {
        this._lyric = new Lyric();
        this._mpris = hook({
            update: (_p, song) => this._updateSong(song),
            closed: (_p, closed) => { this.closed = closed; },
            status: (_p, status) => { this.playing = status; },
            seeked: (_p, position) => this.setPosition(position),
        }, new Mpris());
        this._fulu = new Fulu({}, gset, this);
        this._sbt = symbiose(this, () => omit(this, '_mpris', '_lyric', '_paper'), {
            sync: [clearTimeout, x => setTimeout(x, 500)],
            tray: [() => { this.systray = false; }, () => { this.systray = true; }],
            play: [clearInterval, x => x && setInterval(() => this.setPosition(this._paper._moment + this._span + 0.625), this._span)],
        });
    }

    _bindSettings() {
        this._fulu.attach({
            mini:  [Field.MINI, 'boolean'],
            drag:  [Field.DRAG, 'boolean'],
            index: [Field.TIDX, 'uint'],
            path:  [Field.PATH, 'string'],
            span:  [Field.SPAN, 'uint'],
        }, this);
    }

    set path(path) {
        this._lyric.location = path;
    }

    set mini(mini) {
        this._mini = mini;
        if(!this._btn) return;
        if(this._paper) omit(this, 'playing', '_paper');
        if(mini) {
            this._paper = new PanelPaper(this._fulu);
            this._btn._box.add_child(this._paper);
            this._menus.drag.hide();
        } else {
            this._paper = new DesktopPaper(this._fulu);
            this._menus.drag.show();
        }
        this.loadLyric();
    }

    set systray(systray) {
        if(xnor(systray, this._btn)) return;
        if(systray) {
            this._btn = new PanelButton('lyric-symbolic', this._index ? 0 : 5, ['left', 'center', 'right'][this._index ?? 0]);
            this._btn.visible = this._showing;
            this._addMenuItems();
            this.mini = this._mini;
        } else {
            if(this._mini) omit(this, '_paper');
            omit(this, '_btn', '_menus');
        }
    }

    set index(index) {
        if(this._index === index) return;
        this._index = index;
        this._sbt.tray.revive();
    }

    set drag(drag) {
        this._drag = drag;
        this._menus?.drag.setToggleState(drag);
    }

    set span(span) {
        this._span = span;
        this._sbt.play.revive(this._sbt.play._delegate);
    }

    set playing(playing) {
        this._updateViz();
        if(xnor(playing, this._sbt.play._delegate)) return;
        this._sbt.play.revive(playing && this._paper);
    }

    set closed(closed) {
        this._showing = !closed;
        if(closed) this.clearLyric();
        if(this._btn) this._btn.visible = this._showing;
    }

    async syncPosition() {
        this._sbt.sync.dispel();
        let len = this._song.length;
        let pos = await this._mpris.getPosition().catch(noop);
        for(let i = 0; pos && (pos === this._pos || !len || len - pos < 2000) && i < 7; i++) {
            await new Promise(resolve => this._sbt.sync.revive(resolve));
            pos = await this._mpris.getPosition().catch(noop);
        } // HACK: workaround for stale positions from buggy NCM mpris when changing songs
        this.setPosition((this._pos = pos) + 50);
    }

    _updateSong(song) {
        if(homolog(this._song, song, undefined, (x, y, k) => {
            switch(k) {
            case 'lyric': return x?.length === y?.length;
            case 'length': return true; // HACK: workaround for jumping lengths from NCM mpris
            default: return x === y;
            }
        })) {
            if(this._paper) this._paper.span = this._song.length = song.length; // HACK: ditto
            this.syncPosition();
        } else {
            this._song = song;
            this.loadLyric();
        }
    }

    setPosition(pos) {
        this._paper.moment = pos;
    }

    loadLyric(reload) {
        if(!this._song) return;
        if(this._song.lyric === null) {
            this.setLyric('');
            this._lyric.load(this._song, reload).then(x => this.setLyric(x)).catch(noop);
        } else {
            this.setLyric(this._song.lyric);
        }
    }

    setLyric(text) {
        if(!this._paper) return;
        this._paper.song = this._mini ? Lyric.format(this._song, ' - ', '/') : '';
        this._paper.span = this._song.length;
        this._paper.text = text;
        this.playing = this._mpris.status;
        this.syncPosition();
    }

    clearLyric() {
        this.playing = false;
        this._paper.clearLyric();
        this._song = null;
    }

    _updateViz() {
        let viz = this._mpris.status && !this._menus?.hide.state;
        if(this._paper && this._paper.visible ^ viz) this._paper.visible = viz;
    }

    _addMenuItems() {
        this._menus = {
            hide:   new SwitchItem(_('Invisiblize'), false, () => this._updateViz()),
            mini:   new SwitchItem(_('Minimize'), this._mini, x => this._fulu.set('mini', x, this)),
            drag:   new SwitchItem(_('Mobilize'), this._drag, x => this._fulu.set('drag', x, this)),
            sep0:   new PopupMenu.PopupSeparatorMenuItem(),
            reload: new MenuItem(_('Redownload'), () => this.loadLyric(true)),
            resync: new MenuItem(_('Resynchronize'), () => this.syncPosition().catch(noop)),
            sep1:   new PopupMenu.PopupSeparatorMenuItem(),
            prefs:  new MenuItem(_('Settings'), () => getSelf().openPreferences()),
        };
        Object.values(this._menus).forEach(x => this._btn.menu.addMenuItem(x));
    }
}

export default class Extension extends ExtensionBase { $klass = DesktopLyric; }
