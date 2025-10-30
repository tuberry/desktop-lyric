// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as T from './util.js';
import * as M from './menu.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

import Lyric from './lyric.js';
import Mpris from './mpris.js';
import * as Paper from './paper.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const {_} = F;
const {$, $$} = T;

class DesktopLyric extends F.Mortal {
    constructor(gset) {
        super()[$].$bindSettings(gset)[$].$buildSources();
    }

    $bindSettings(gset) {
        this.$set = new F.Setting(gset, [
            [K.AREA, null, () => this.#onAreaSet()],
            [K.MINI, null, () => this.#onMiniSet()],
            [K.DRAG, null, x => this.#onDragSet(x)],
            [K.SPAN, null, x => this.$src.play.reload(x)],
        ], this);
    }

    $buildSources() {
        let tray = F.Source.new(() => this.#genSystray(), true),
            play = F.Source.newTimer((x = this[K.SPAN]) => [() => this.setPosition(this.$src.paper.hub.moment + x + 0.225), x], false),
            paper = F.Source.new(() => this[K.MINI] ? new Paper.Panel(tray.hub, this.$set) : new Paper.Desktop(this[K.DRAG], this.$set), true),
            lyric = new Lyric(this.$set),
            mpris = new Mpris(this.$set)[$$].connect([
                ['update', (_p, x) => this.setSong(x)],
                ['active', (_p, x) => this.setActive(x)],
                ['status', (_p, x) => this.setPlaying(x)],
                ['seeked', (_p, x) => this.setPosition(x)],
            ]),
            sync = F.Source.newDefer(x => x.length && this.setPosition(this.$pos = x.at(0)), // HACK: workaround for stale positions from buggy NCM mpris when changing songs
                async n => (x => this.$pos !== x && [x])(await mpris.getPosition().catch(T.nop)) || (n > 5 && []), 500);
        this.$src = F.Source.tie({play, paper, tray, lyric, mpris, sync}, this); // NOTE: `paper` prior `tray` to avoid double free
        
        // Add dynamic menu items after mpris is initialized
        this.#updateDynamicMenuItems();
    }

    #genSystray() {
        return new M.Systray({
            hide: new M.SwitchItem(_('Invisiblize'), false, () => this.#viewPaper()),
            mini: new M.SwitchItem(_('Minimize'), this[K.MINI], x => this.$set.set(K.MINI, x)),
            drag: this[K.MINI] ? null : this.#genDragItem(),
            sep0: new M.Separator(),
            // player menu will be added later via M.record after mpris is initialized
            sep1a: new M.Separator(),
            tidy: new M.Item(_('Unload'), () => this[$].setLyric('').$src.lyric.unload(this.song)),
            load: new M.Item(_('Reload'), () => this.loadLyric(true)),
            // sync: new M.Item(_('Resynchronize'), () => this.$src.sync.revive()),
            sep1: new M.Separator(),
            sets: new M.Item(_('Settings'), () => F.me().openPreferences()),
        }, 'lyric-symbolic', this[K.AREA] ? 0 : 5, ['left', 'center', 'right'][this[K.AREA]] ?? 'left')[$]
            .set({visible: this.$src?.mpris.active ?? false});
    }

    #viewPaper() {
        F.view(this.$src.mpris.status && !this.$src.tray.hub.$menu.hide.state, this.$src.paper.hub);
    }

    #genDragItem() {
        return new M.SwitchItem(_('Mobilize'), this[K.DRAG], x => this.$set.set(K.DRAG, x));
    }

    #updateDynamicMenuItems() {
        // Add all dynamic menu items that need to be recreated when tray is recreated
        M.record(true, this.$src.tray.hub, () => this.#genPlayerItem(), 'player', 'sep0');
    }

    #genPlayerItem() {
        // Create a PopupSubMenuMenuItem
        const item = new PopupMenu.PopupSubMenuMenuItem(_('MPRIS Player'));
        
        // Add hint at the top
        const hintItem = new PopupMenu.PopupMenuItem(_('Select to enable lyrics'));
        hintItem.setSensitive(false);
        item.menu.addMenuItem(hintItem);
        
        // Add separator after hint
        item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add "Auto" option
        const autoItem = new PopupMenu.PopupMenuItem(_('Auto'));
        autoItem.connect('activate', () => {
            this.$src.mpris.setPreferredPlayer('');
            this.#updatePlayerMenuLabel(item);
        });
        item.menu.addMenuItem(autoItem);
        
        // Add "None" option
        const noneItem = new PopupMenu.PopupMenuItem(_('None'));
        noneItem.connect('activate', () => {
            this.$src.mpris.setPreferredPlayer('none');
            this.#updatePlayerMenuLabel(item);
        });
        item.menu.addMenuItem(noneItem);
        
        // Update menu when it opens
        item.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this.#updatePlayerMenuItems(item);
            }
        });
        
        // Initial label update
        this.#updatePlayerMenuLabel(item);
        
        return item;
    }
    
    #updatePlayerMenuLabel(item) {
        const preferred = this.$src.mpris.getPreferredPlayer();
        if (preferred === 'none') {
            item.label.set_text(`${_('MPRIS Player')}: ${_('None')}`);
        } else if (preferred) {
            item.label.set_text(`${_('MPRIS Player')}: ${this.#formatPlayerName(preferred)}`);
        } else {
            item.label.set_text(`${_('MPRIS Player')}: ${_('Auto')}`);
        }
    }
    
    #updatePlayerMenuItems(item) {
        const players = this.$src.mpris.getAvailablePlayers();
        const preferred = this.$src.mpris.getPreferredPlayer();
        
        // Clear existing items except the first four (hint, separator, Auto, None)
        const items = item.menu._getMenuItems();
        for (let i = items.length - 1; i >= 4; i--) {
            items[i].destroy();
        }
        
        // Set ornament for Auto and None items (indices 2 and 3)
        items[2].setOrnament(!preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        items[3].setOrnament(preferred === 'none' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        
        // Add player items
        players.forEach((name) => {
            const info = this.$src.mpris.getPlayerInfo(name);
            const displayText = this.#formatPlayerDisplay(name, info);
            const playerItem = new PopupMenu.PopupMenuItem(displayText);
            playerItem.connect('activate', () => {
                // Toggle: if clicking already selected player, deselect it (set to 'none')
                if (name === preferred) {
                    this.$src.mpris.setPreferredPlayer('none', false);
                } else {
                    this.$src.mpris.setPreferredPlayer(name, true); // Mark as manual selection
                }
                this.#updatePlayerMenuLabel(item);
            });
            playerItem.setOrnament(name === preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
            item.menu.addMenuItem(playerItem);
        });
    }
    
    #formatPlayerName(name) {
        // Format player name for display: org.mpris.MediaPlayer2.chromium.instance123 -> chromium
        const match = name.match(/org\.mpris\.MediaPlayer2\.([^.]+)/);
        return match ? match[1] : name;
    }

    #formatPlayerDisplay(name, info) {
        // Format player display with type badge and current title
        const MAX_TITLE_LENGTH = 30;
        const TYPE_BADGE = {video: '🎬', audio: '🎵'};
        
        const playerName = this.#formatPlayerName(name);
        const typeBadge = info.isVideo ? TYPE_BADGE.video : TYPE_BADGE.audio;
        
        if (!info.currentTitle) {
            return `${typeBadge} ${playerName}`;
        }
        
        // Truncate long titles
        const title = info.currentTitle.length > MAX_TITLE_LENGTH
            ? info.currentTitle.substring(0, MAX_TITLE_LENGTH) + '...'
            : info.currentTitle;
        
        return `${typeBadge} ${playerName} - ${title}`;
    }

    #onMiniSet() {
        M.record(!this[K.MINI], this.$src.tray.hub, () => this.#genDragItem(), 'drag', 'sep0');
        this.$src.paper.revive(this[K.MINI]);
        this.loadLyric();
    }

    #onAreaSet() {
        let wasActive = this.$src.mpris.active;
        if(this[K.MINI]) {
            this.setPlaying(false);
            this.$src.paper.dispel();
        }
        this.$src.tray.revive();
        this.#updateDynamicMenuItems();
        this.#onMiniSet();
        // Restore tray visibility after recreation
        if(wasActive) F.view(true, this.$src.tray.hub);
    }

    #onDragSet(drag) {
        if(this[K.MINI]) return;
        this.$src.paper.hub.setDrag(drag);
        this.$src.tray.hub.$menu.drag.setToggleState(drag);
    }

    setPlaying(playing) {
        this.#viewPaper();
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
        this.$src.paper.hub.setMoment(pos);
    }

    setSong(song) {
        if(T.homolog(this.song, song, ['title', 'album', 'lyric', 'artist'])) {
            this.$src.paper.hub?.setLength(this.song.length = song.length); // HACK: workaround for jumping lengths from NCM mpris
            this.$src.sync.revive();
        } else {
            this.song = song;
            this.loadLyric();
        }
    }

    loadLyric(reload) {
        if(!this.song) return;
        
        // Check if we should search for lyrics (respects manual selection)
        if(!this.$src.mpris.shouldSearchLyrics()) {
            // For video players (not manually selected), don't search for lyrics, just show title
            this.setLyric('');
            return;
        }
        
        if(this.song.lyric === null) {
            this.setLyric('');
            this.$src.lyric.load(this.song, reload).then(x => this.setLyric(x)).catch(T.nop);
        } else {
            this.setLyric(this.song.lyric);
        }
    }

    setLyric(lyrics) {
        if(!this.$src.paper.active) return;
        this.$src.paper.hub[$].song(this[K.MINI] ? Lyric.name(this.song, ' - ', '/') : '')[$]
            .setLength(this.song.length)[$]
            .setLyrics(lyrics);
        this.setPlaying(this.$src.mpris.status);
        this.$src.sync.revive();
    }
}

export default class extends F.Extension { $klass = DesktopLyric; }
