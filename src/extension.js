// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Field} from './const.js';
import {Lyric} from './lyric.js';
import {Mpris} from './mpris.js';
import * as Util from './util.js';
import * as Menu from './menu.js';
import * as Fubar from './fubar.js';
import * as Paper from './paper.js';

const {_} = Fubar;

class DesktopLyric extends Fubar.Mortal {
    constructor(gset) {
        super();
        this.#bindSettings(gset);
        this.#buildSources();
    }

    #bindSettings(gset) {
        this.$set = new Fubar.Setting(gset, {
            area: [Field.AREA, 'uint',    null, () => this.#onAreaSet()],
            mini: [Field.MINI, 'boolean', null, () => this.#onMiniSet()],
            span: [Field.SPAN, 'uint',    null, x => this.$src.play.reload(x)],
            drag: [Field.DRAG, 'boolean', null, x => this.tray.$menu.drag.setToggleState(x)],
        }, this);
    }

    #buildSources() {
        let sync  = Fubar.Source.newTimer(x => [x, 500]),
            tray  = Fubar.Source.new(() => this.#genSystray(), true),
            play  = Fubar.Source.newTimer((x = this.span) => [() => this.setPosition(this.paper.moment + x + 0.225), x], false),
            paper = Fubar.Source.new(() => this.mini ? new Paper.Panel(tray.hub, this.$set) : new Paper.Desktop(this.$set), true),
            lyric = new Lyric(this.$set),
            mpris = Util.hook({
                update: (_p, x) => this.setSong(x),
                status: (_p, x) => this.setPlaying(x),
                closed: (_p, x) => this.setVisible(!x),
                seeked: (_p, x) => this.setPosition(x),
            }, new Mpris());
        this.$src = Fubar.Source.tie({play, paper, tray, sync, lyric, mpris}, this); // NOTE: `paper` prior `tray` to avoid double free
    }

    get paper() {
        return this.$src.paper.hub;
    }

    get tray() {
        return this.$src.tray.hub;
    }

    #genSystray() {
        return new Menu.Systray({
            hide: new Menu.SwitchItem(_('Invisiblize'), false, () => this.#viewPaper()),
            mini: new Menu.SwitchItem(_('Minimize'), this.mini, x => this.$set.set('mini', x, this)),
            drag: this.mini ? null : this.#genDragItem(),
            sep0: new PopupMenu.PopupSeparatorMenuItem(),
            sync: new Menu.Item(_('Resynchronize'), () => this.syncPosition().catch(Util.noop)),
            load: new Menu.Item(_('Reload'), () => this.loadLyric(true)),
            sep1: new PopupMenu.PopupSeparatorMenuItem(),
            sets: new Menu.Item(_('Settings'), () => Fubar.me().openPreferences()),
        }, 'lyric-symbolic', this.area ? 0 : 5, ['left', 'center', 'right'][this.area] ?? 'left', {visible: this.visible});
    }

    #viewPaper() {
        Fubar.view(this.$src.mpris.status && !this.tray.$menu.hide.state, this.paper);
    }

    #genDragItem() {
        return new Menu.SwitchItem(_('Mobilize'), this.drag, x => this.$set.set('drag', x, this));
    }

    #onMiniSet() {
        Menu.record(!this.mini, this.tray, () => this.#genDragItem(), 'drag', 'sep0');
        this.$src.paper.revive(this.mini);
        this.loadLyric();
    }

    #onAreaSet() {
        if(this.mini) {
            this.setPlaying(false);
            this.$src.paper.dispel();
        }
        this.$src.tray.revive();
        this.#onMiniSet();
    }

    setPlaying(playing) {
        this.#viewPaper();
        this.$src.play.toggle(playing && this.paper);
    }

    setVisible(visible) {
        this.visible = visible;
        Fubar.view(visible, this.tray);
        if(!visible) this.clearLyric();
    }

    async syncPosition() {
        this.$src.sync.dispel();
        let len = this.song.length;
        let pos = await this.$src.mpris.getPosition().catch(Util.noop);
        for(let i = 0; pos && (pos === this.$pos || !len || len - pos < 2000) && i < 7; i++) {
            await new Promise(resolve => this.$src.sync.revive(resolve));
            pos = await this.$src.mpris.getPosition().catch(Util.noop);
        } // HACK: workaround for stale positions from buggy NCM mpris when changing songs
        this.setPosition((this.$pos = pos) + 50);
    }

    setPosition(pos) {
        this.paper.setMoment(pos);
    }

    setSong(song) {
        if(Util.homolog(this.song, song, ['title', 'album', 'lyric', 'artist'])) {
            this.paper?.setLength(this.song.length = song.length); // HACK: workaround for jumping lengths from NCM mpris
            this.syncPosition();
        } else {
            this.song = song;
            this.loadLyric();
        }
    }

    loadLyric(reload) {
        if(!this.song) return;
        if(this.song.lyric === null) {
            this.setLyric('');
            this.$src.lyric.load(this.song, reload).then(x => this.setLyric(x)).catch(Util.noop);
        } else {
            this.setLyric(this.song.lyric);
        }
    }

    setLyric(lyrics) {
        if(!this.paper) return;
        this.paper.song = this.mini ? Lyric.name(this.song, ' - ', '/') : '';
        this.paper.setLength(this.song.length);
        this.paper.setLyrics(lyrics);
        this.setPlaying(this.$src.mpris.status);
        this.syncPosition();
    }

    clearLyric() {
        this.setPlaying(false);
        this.paper.clearLyric();
        delete this.song;
    }
}

export default class Extension extends Fubar.Extension { $klass = DesktopLyric; }
