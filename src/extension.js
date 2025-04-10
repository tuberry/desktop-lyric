// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as T from './util.js';
import * as M from './menu.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

import Lyric from './lyric.js';
import Mpris from './mpris.js';
import * as Paper from './paper.js';

const {_} = F;

class DesktopLyric extends F.Mortal {
    constructor(gset) {
        super();
        this.#bindSettings(gset);
        this.#buildSources();
    }

    #bindSettings(gset) {
        this.$set = new F.Setting(gset, [
            [K.AREA, null, () => this.#onAreaSet()],
            [K.MINI, null, () => this.#onMiniSet()],
            [K.DRAG, null, x => this.#onDragSet(x)],
            [K.SPAN, null, x => this.$src.play.reload(x)],
        ], this);
    }

    #buildSources() {
        let tray = F.Source.new(() => this.#genSystray(), true),
            play = F.Source.newTimer((x = this[K.SPAN]) => [() => this.setPosition(this.paper.moment + x + 0.225), x], false),
            paper = F.Source.new(() => this[K.MINI] ? new Paper.Panel(tray.hub, this.$set) : new Paper.Desktop(this[K.DRAG], this.$set), true),
            lyric = new Lyric(this.$set),
            mpris = T.hook({
                update: (_p, x) => this.setSong(x),
                active: (_p, x) => this.setActive(x),
                status: (_p, x) => this.setPlaying(x),
                seeked: (_p, x) => this.setPosition(x),
            }, new Mpris()),
            sync = F.Source.newDefer(x => x.length && this.setPosition(this.$pos = x.at(0)), // HACK: workaround for stale positions from buggy NCM mpris when changing songs
                async n => (x => this.$pos !== x && [x])(await mpris.getPosition().catch(T.nop)) || (n > 5 && []), 500);
        this.$src = F.Source.tie({play, paper, tray, lyric, mpris, sync}, this); // NOTE: `paper` prior `tray` to avoid double free
    }

    get paper() {
        return this.$src.paper.hub;
    }

    get tray() {
        return this.$src.tray.hub;
    }

    #genSystray() {
        return new M.Systray({
            hide: new M.SwitchItem(_('Invisiblize'), false, () => this.#viewPaper()),
            mini: new M.SwitchItem(_('Minimize'), this[K.MINI], x => this.$set.set(K.MINI, x)),
            drag: this[K.MINI] ? null : this.#genDragItem(),
            sep0: new M.Separator(),
            tidy: new M.Item(_('Unload'), () => { this.setLyric(''); this.$src.lyric.unload(this.song); }),
            load: new M.Item(_('Reload'), () => this.loadLyric(true)),
            // sync: new M.Item(_('Resynchronize'), () => this.$src.sync.revive()),
            sep1: new M.Separator(),
            sets: new M.Item(_('Settings'), () => F.me().openPreferences()),
        }, 'lyric-symbolic', this[K.AREA] ? 0 : 5, ['left', 'center', 'right'][this[K.AREA]] ?? 'left', {visible: this.$src?.mpris.active ?? false});
    }

    #viewPaper() {
        F.view(this.$src.mpris.status && !this.tray.$menu.hide.state, this.paper);
    }

    #genDragItem() {
        return new M.SwitchItem(_('Mobilize'), this[K.DRAG], x => this.$set.set(K.DRAG, x));
    }

    #onMiniSet() {
        M.record(!this[K.MINI], this.tray, () => this.#genDragItem(), 'drag', 'sep0');
        this.$src.paper.revive(this[K.MINI]);
        this.loadLyric();
    }

    #onAreaSet() {
        if(this[K.MINI]) {
            this.setPlaying(false);
            this.$src.paper.dispel();
        }
        this.$src.tray.revive();
        this.#onMiniSet();
    }

    #onDragSet(drag) {
        if(this[K.MINI]) return;
        this.paper.setDrag(drag);
        this.tray.$menu.drag.setToggleState(drag);
    }

    setPlaying(playing) {
        this.#viewPaper();
        this.$src.play.toggle(playing && this.paper);
    }

    setActive(active) {
        F.view(active, this.tray);
        if(active) return;
        this.setPlaying(false);
        this.paper.clearLyric();
        delete this.song;
    }

    setPosition(pos) {
        this.paper.setMoment(pos);
    }

    setSong(song) {
        if(T.homolog(this.song, song, ['title', 'album', 'lyric', 'artist'])) {
            this.paper?.setLength(this.song.length = song.length); // HACK: workaround for jumping lengths from NCM mpris
            this.$src.sync.revive();
        } else {
            this.song = song;
            this.loadLyric();
        }
    }

    loadLyric(reload) {
        if(!this.song) return;
        if(this.song.lyric === null) {
            this.setLyric('');
            this.$src.lyric.load(this.song, reload).then(x => this.setLyric(x)).catch(T.nop);
        } else {
            this.setLyric(this.song.lyric);
        }
    }

    setLyric(lyrics) {
        if(!this.paper) return;
        this.paper.song = this[K.MINI] ? Lyric.name(this.song, ' - ', '/') : '';
        this.paper.setLength(this.song.length);
        this.paper.setLyrics(lyrics);
        this.setPlaying(this.$src.mpris.status);
        this.$src.sync.revive();
    }
}

export default class extends F.Extension { $klass = DesktopLyric; }
