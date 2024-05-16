// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Field} from './const.js';
import {Lyric} from './lyric.js';
import {Mpris} from './mpris.js';
import {noop, homolog, hook} from './util.js';
import {DesktopPaper, PanelPaper} from './paper.js';
import {SwitchItem, MenuItem, Systray} from './menu.js';
import {Setting, Extension, Mortal, Source, view, myself, _} from './fubar.js';

class DesktopLyric extends Mortal {
    constructor(gset) {
        super();
        this.$buildWidgets(gset);
        this.$bindSettings();
    }

    $buildWidgets(gset) {
        this.$set = new Setting(null, gset, this);
        this.$src = Source.fuse({
            mpris: hook({
                update: (_p, x) => this.setSong(x),
                status: (_p, x) => this.setPlaying(x),
                closed: (_p, x) => this.setVisible(!x),
                seeked: (_p, x) => this.setPosition(x),
            }, new Mpris()),
            lyric: new Lyric(this.$set),
            paper: new Source(x => x ? new PanelPaper(this.$set) : new DesktopPaper(this.$set)), // above tray
            play: Source.newTimer((x = this.span) => [() => this.setPosition(this.paper.moment + x + 0.625), x], false),
            tray: new Source(() => this.$genSystray()),
            sync: Source.newTimer(x => [x, 500]),
        }, this);
    }

    get paper() {
        return this.$src.paper.hub;
    }

    $bindSettings() {
        this.$set.attach({
            drag: [Field.DRAG, 'boolean', x => this.$menu?.drag.setToggleState(x)],
            mini: [Field.MINI, 'boolean', x => this.$onMiniSet(x)],
            tray: [Field.TIDX, 'uint',    x => this.$onTraySet(x)],
            span: [Field.SPAN, 'uint',    x => this.$src.play.reload(x)],
        }, this);
    }

    $onMiniSet(mini) {
        if(!this.$src.tray.active) return;
        if(this.mini !== mini || !this.paper) {
            this.$src.paper.revive(mini);
            this.loadLyric();
        }
        if(mini) this.$src.tray.hub.append(this.paper);
        view(!mini, this.$menu?.drag);
    }

    $onTraySet(tray) {
        if(this.tray === tray) return;
        if(this.mini) {
            this.setPlaying(false);
            this.$src.paper.dispel();
        }
        this.$src.tray.revive();
        this.$onMiniSet(this.mini);
    }

    setPlaying(playing) {
        this.$viewPaper();
        this.$src.play.toggle(playing && this.paper);
    }

    setVisible(visible) {
        this.visible = visible;
        if(!visible) this.clearLyric();
        view(visible, this.$src.tray.hub);
    }

    async syncPosition() {
        this.$src.sync.dispel();
        let len = this.song.length;
        let pos = await this.$src.mpris.getPosition().catch(noop);
        for(let i = 0; pos && (pos === this.$pos || !len || len - pos < 2000) && i < 7; i++) {
            await new Promise(resolve => this.$src.sync.revive(resolve));
            pos = await this.$src.mpris.getPosition().catch(noop);
        } // HACK: workaround for stale positions from buggy NCM mpris when changing songs
        this.setPosition((this.$pos = pos) + 50);
    }

    setPosition(pos) {
        this.paper.setMoment(pos);
    }

    setSong(song) {
        if(homolog(this.song, song, ['title', 'album', 'lyric', 'artist'])) {
            this.paper?.setSpan(this.song.length = song.length); // HACK: workaround for jumping lengths from NCM mpris
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
            this.$src.lyric.load(this.song, reload).then(x => this.setLyric(x)).catch(noop);
        } else {
            this.setLyric(this.song.lyric);
        }
    }

    setLyric(text) {
        if(!this.paper) return;
        this.paper.song = this.mini ? Lyric.format(this.song, ' - ', '/') : '';
        this.paper.setSpan(this.song.length);
        this.paper.setText(text);
        this.setPlaying(this.$src.mpris.status);
        this.syncPosition();
    }

    clearLyric() {
        this.setPlaying(false);
        this.paper.clearLyric();
        delete this.song;
    }

    $viewPaper() {
        view(this.$src.mpris.status && !this.$menu?.hide.state, this.paper);
    }

    get $menu() {
        return this.$src.tray.hub?.$menu;
    }

    $genSystray() {
        return new Systray({
            hide:   new SwitchItem(_('Invisiblize'), false, () => this.$viewPaper()),
            mini:   new SwitchItem(_('Minimize'), this.mini, x => this.$set.set('mini', x, this)),
            drag:   new SwitchItem(_('Mobilize'), this.drag, x => this.$set.set('drag', x, this)),
            sep0:   new PopupMenu.PopupSeparatorMenuItem(),
            reload: new MenuItem(_('Redownload'), () => this.loadLyric(true)),
            resync: new MenuItem(_('Resynchronize'), () => this.syncPosition().catch(noop)),
            sep1:   new PopupMenu.PopupSeparatorMenuItem(),
            prefs:  new MenuItem(_('Settings'), () => myself().openPreferences()),
        }, 'lyric-symbolic', this.tray ? 0 : 5, ['left', 'center', 'right'][this.tray] ?? 'left', {visible: this.visible});
    }
}

export default class MyExtension extends Extension { $klass = DesktopLyric; }
