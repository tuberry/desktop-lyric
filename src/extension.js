// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as T from './util.js';
import * as M from './menu.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

import Lyric from './lyric.js';
import Mpris from './mpris.js';
import * as Paper from './paper.js';

const {_} = F;
const {$, $$, $_} = T;

class DesktopLyric extends F.Mortal {
    $bindSettings(gset) {
        this.$set = new F.Setting(gset).tie(this, [
            [K.MINI, null, x => this.$onMiniSet(x)],
            [K.DRAG, null, x => this.$onDragSet(x)],
            [K.SPAN, null, x => this.$src.play.reload(x)],
            [K.AREA, x => [(2 - x) ** 4, ['left', 'center', 'right'][x]], x => this.$onAreaSet(x)],
        ]);
    }

    $buildSources() {
        let lyric = new Lyric(this.$set),
            tray = new F.Source(() => this.$genSystray(), true),
            play = new F.Source.Timer((x = this[K.SPAN]) => [() => this.setPosition(this.$src.paper.hub.moment + x + 0.225), x], false),
            paper = new F.Source(() => this[K.MINI] ? new Paper.Panel(tray.hub, this.$set) : new Paper.Desktop(this[K.DRAG], this.$set), true),
            sync = new F.Source.Defer(x => x.length && this.setPosition(this.$pos = x.at(0)), // HACK: workaround for stale positions from buggy NCM mpris when changing songs
                async n => (x => this.$pos !== x && [x])(await this.$src.mpris.getPosition().catch(T.nop)) || (n > 5 && []), 500),
            mpris = new Mpris(this.$set)[$$].connect([
                ['update', (_p, x) => this.setSong(x)],
                ['active', (_p, x) => this.setActive(x)],
                ['status', (_p, x) => this.setPlaying(x)],
                ['seeked', (_p, x) => this.setPosition(x)],
            ])[$_](it => tray.hub.$record(true, 'play', () => it.genPlayerItem()));
        this.$src = F.Source.tie(this, {mpris, play, sync, lyric, paper, tray});
    }

    $genSystray() {
        return new M.Systray({
            hide: new M.SwitchItem(_('Hide'), false, () => this.$viewPaper()),
            mini: new M.SwitchItem(_('Minimize'), this[K.MINI], x => this.$set.set(K.MINI, x)),
            drag: this[K.MINI] ? null : this.$genDragItem(),
            sep0: new M.Separator(),
            tidy: new M.Item(_('Unload'), () => this[$].setLyric('').$src.lyric.unload(this.song)),
            load: new M.Item(_('Reload'), () => this.loadLyric(true)),
            // sync: new M.Item(_('Resynchronize'), () => this.$src.sync.revive()),
            play: null, // lateinit
            sep1: new M.Separator(),
            sets: new M.Item(_('Settings'), () => F.me().openPreferences()),
        }, M.Icon.wrap('lyric-symbolic'), ...this[K.AREA])[$].connect('notify::width', ({width, menu}) => {
            let align = width > menu.box.width ? 0 : 0.5;
            if(align !== menu._arrowAlignment) menu._arrowAlignment = align;
            if(align !== menu._boxPointer._sourceAlignment) menu.setSourceAlignment(align);
        })[$].set({visible: false});
    }

    $viewPaper() {
        F.view(this.$src.mpris.status && !this.$src.tray.hub.$menu.hide.state, this.$src.paper.hub);
    }

    $genDragItem() {
        return new M.SwitchItem(_('Mobilize'), this[K.DRAG], x => this.$set.set(K.DRAG, x));
    }

    $onMiniSet(mini) {
        this.$src.tray.hub.$record(!mini, 'drag', () => this.$genDragItem());
        this.$src.paper.revive(mini);
        this.loadLyric();
    }

    $onAreaSet([index, pos]) {
        let {container} = this.$src.tray.hub;
        container.get_parent().remove_child(container);
        Main.panel[`_${pos}Box`].insert_child_at_index(container, index);
    }

    $onDragSet(drag) {
        if(this[K.MINI]) return;
        this.$src.paper.hub.setDrag(drag);
        this.$src.tray.hub.$menu.drag.setToggleState(drag);
    }

    setPlaying(playing) {
        this.$viewPaper();
        this.$src.play.toggle(playing && this.$src.paper.hub);
    }

    setActive(active) {
        F.view(active, this.$src.tray.hub);
        if(active) return;
        this.setPlaying(false);
        this.$src.paper.hub.clearLyric();
        delete this.song;
    }

    setPosition(pos) {
        this.$src.paper.hub?.setMoment(pos);
    }

    setSong(song) {
        if(T.homolog(this.song, song, ['title', 'album', 'lyric', 'artist'])) {
            this.$src.paper.hub.setLength(this.song.length = song.length); // HACK: workaround for jumping lengths from NCM mpris
            this.$src.sync.revive();
        } else {
            this.song = song;
            this.loadLyric();
        }
    }

    loadLyric(reload) {
        if(!this.song) return;
        if(this.song.lyric !== null) this.setLyric(this.song.lyric);
        else this.$src.lyric.load(this.song, () => this.setLyric(''), reload).then(x => this.setLyric(x)).catch(T.nop);
    }

    setLyric(lyrics) {
        if(!this.$src.paper.active) return;
        this.$src.paper.hub[$].song(this[K.MINI] ? Lyric.term(this.song, ' - ', '/') : '')[$]
            .setLength(this.song.length)
            .setLyrics(lyrics);
        this.setPlaying(this.$src.mpris.status);
        this.$src.sync.revive();
    }
}

export default class extends F.Extension { $klass = DesktopLyric; }
