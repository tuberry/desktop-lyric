// SPDX-FileCopyrightText: tuberry
// SPDX-FileCopyrightText: NowLoadY
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const Media = Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource;

import * as M from './menu.js';
import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const {_} = F;
const {$, $$, $s, $_, hub} = T;

const spot = x => x._mprisProxy.Identity;
const playing = x => x.PlaybackStatus === 'Playing';

const Pin = {PREFER: 0, ONLY: 1};

export default class Mpris extends F.Mortal {
    $bindSettings(set) {
        this.$set = set.tie(this, [K.PLCY, [
            ['pin', K.PLST], v => v.reverse().reduceRight((p, x, i) => p.set(x, i), new Map()),
        ]], null, () => this.$refresh());
    }

    $buildSources() {
        let proxy = F.Source.newDBusProxy(null, '/org/mpris/MediaPlayer2',
                (...xs) => this.$onProxyReady(...xs),
                ['g-properties-changed', (...xs) => this.$onProxyChange(...xs)],
                ['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)],
                'org.gnome.Shell.Extensions.DesktopLyric.MprisPlayer'),
            tap = new F.Source(() => new WeakMap()[$$](it => this.$players.forEach(x => this.$listen(x, it))),
                x => this.$players.forEach(p => this.$close(p, x)), true),
            media = F.Source.newHandler(Media, 'player-added', (_a, p) => { this.$listen(p) && this.$refresh(); },
                'player-removed', (a, p) => { !a._players.has(p._busName) && this.$close(p) && this.$refresh(); });
        this.$src = F.Source.tie(this, {tap, proxy}, media);
        this.$buildWidgets();
    }

    $listen(player, tap = this.$src.tap.hub) {
        if(tap.has(player) || this.$nonMusical(player)) return false;
        let info = {time: 0};
        let data = new Proxy(info, {set: (...xs) => { this.$refresh(); return Reflect.set(...xs); }});
        info.id = player._playerProxy.connect('g-properties-changed', (a, p) => {
            if(p.lookup_value('PlaybackStatus', null)) data.time = playing(a) ? Date.now() : data.time;
        });
        tap.set(player, data);
        return true;
    }

    $close(player, tap = this.$src.tap.hub) {
        return tap.has(player)[$$](x => x && player._playerProxy.disconnect(tap.get(player).id));
    }

    $nonMusical({_app: app}) {
        if(app === undefined) return true;
        if(app === null) return false; // terminal
        let ret = true;
        for(let cat of app.get_app_info()?.get_categories().split(';') ?? []) {
            if(cat === 'WebBrowser' || cat === 'Video') return true;
            if(cat === 'Audio' || cat === 'Music') ret = false;
        }
        return ret;
    }

    $buildWidgets() {
        this.$metadata = ['xesam:title', 'xesam:artist', 'xesam:asText', 'xesam:album', 'mpris:length']; // Ref: https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        this.$priority = [
            (p, t, i) => t.has(p) && !(this.pin.size && i < 0 && this[K.PLCY] === Pin.ONLY) || -1, // musical
            (p, t, i) => i >= 0, // pinned
            p => playing(p._playerProxy), // playing
            (p, t, i) => i < 0 ? t.get(p).time : i, // recent
            p => Object.hasOwn(p._playerProxy.Metadata, 'xesam::asText'), // lyrics
        ];
        this.$refresh();
    }

    $refresh(tap = this.$src.tap.hub) {
        let best,
            priors = this.$priority.length,
            scores = new Int8Array(priors);
        out: for(let player of this.$players) {
            let buf = [],
                cmp = true,
                pin = this.$pindex(player);
            for(let delta, score, i = 0; i < priors; i++) {
                score = this.$priority[i](player, tap, pin);
                if(cmp) {
                    delta = score - scores[i];
                    if(delta < 0) continue out;
                    if(delta > 0) cmp = false, best = player._busName;
                }
                buf.push(score);
            }
            if(!cmp) scores = buf;
        }
        if(best === this.$bus) return;
        this.$activate(false);
        this.$src.proxy.switch(best, best);
    }

    get $players() {
        return Media._players.values();
    }

    get $bus() {
        return this.$src.proxy.hub?.gName;
    }

    get $player() {
        return Media._players.get(this.$bus);
    }

    $pindex(player) {
        return this.pin.get(spot(player)) ?? -1;
    }

    $activate(active) {
        this.emit('active', this.active = active);
    }

    $onProxyReady(proxy) {
        if(!proxy) return;
        this.$activate(true);
        this.$update(proxy.Metadata);
    }

    $onProxyChange(proxy, prop) {
        if(prop.lookup_value('Metadata', null)) this.$update(proxy.Metadata);
        if(prop.lookup_value('PlaybackStatus', null)) this.emit('status', playing(proxy));
    }

    $update(metadata) {
        let [title, artist, lyric, album, length] = this.$metadata.map(x => metadata[x]?.deepUnpack());
        this.emit('update', {
            title: T.str(title) ? title : '',
            album: T.str(album) ? album : '',
            lyric: T.str(lyric) ? lyric : null,
            length: Number.isFinite(length) ? length / 1000 : 0,
            artist: artist?.every?.(T.str) ? artist.flatMap(x => x.split('/')).filter(T.id) : [],
        });
    }

    genPlayerItem() {
        let txt = _('Player');
        return new PopupMenu.PopupSubMenuMenuItem(txt)[$$](it => {
            this.connect('active', (_a, x) => it.label.set_text(x ? `${txt}: ${this.$player.source.title ?? spot(this.$player)}` : txt));
            it.menu[$s].addMenuItem([
                new PopupMenu.PopupMenuSection()[$].connect('open-state-changed', (sub, open) => open && M.upsert(sub,
                    menu => menu.addMenuItem(new PopupMenu.PopupImageMenuItem('', '')[$].connect('activate', ({[hub]: id}) =>
                        this.$set.set(K.PLST, this.pin.keys().toArray()[$_]
                            .splice(this.pin.has(id), this.pin.size - 1 - this.pin.get(id), 1)[$_]
                            .unshift(!this.pin.has(id) || id !== spot(this.$player), id)))),
                    this.$players.filter(x => this.$src.tap.hub.has(x)).toArray().sort((a, b) => this.$pindex(b) - this.$pindex(a)),
                    (player, item) => item[$][hub](spot(player))[$]
                        .setIcon(player.app?.get_icon() ?? 'audio-x-generic-symbolic')[$]
                        .setOrnament(this.pin.has(item[hub]) ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE)
                        .label.set_text(player.source.title))),
                new M.Separator(),
                new M.Item(_('Clear'), () => this.$set.set(K.PLST, [])),
            ]);
        });
    }

    async getPosition() { // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this.$bus, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.proxy.active && playing(this.$src.proxy.hub);
    }
}
