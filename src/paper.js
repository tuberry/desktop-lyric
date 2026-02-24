// SPDX-FileCopyrightText: tuberry
// SPDX-FileCopyrightText: NowLoadY
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const {$, $$, $s} = T;

const time2ms = time => Math.round(time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000); // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha = 255}, opacity) => [red, green, blue].map(x => x / 255)[$].push(opacity ?? alpha / 255);

function findMaxLE(sorted, value, lower = 0, upper = sorted.length - 1) { // sorted: ascending
    if(sorted[upper] <= value) {
        return upper;
    } else {
        while(lower <= upper) {
            let index = (lower + upper) >>> 1;
            if(sorted[index] <= value && sorted[index + 1] > value) return index;
            else if(sorted[index] > value) upper = index - 1;
            else lower = index + 1;
        }
        return -1;
    }
}

class PaperBase extends St.DrawingArea {
    static {
        T.enrol(this);
    }

    constructor(set, param) {
        super(param)[$]
            .$clearLyric()[$]
            .$bindSettings(set)[$]
            .$buildWidgets();
    }

    $bindSettings(set) {
        this.$set = set.tie(this, [[K.PRGR, x => !x]], () => { this.$scroll = true; this.queue_repaint(); }); // NOTE: force redrawing
    }

    $buildWidgets() {
        F.Source.tie(this, F.Source.newHandler(F.theme(), 'changed', (() => this.$onColorChange())[$].call()));
    }

    $setFont(font) {
        this.$font = font;
        let ratio = font.get_size() / Pango.FontDescription.from_string('Sans 12').get_size();
        this.$title = [30 / ratio, 16 * 4 * ratio, 16 * 3 * ratio];
    }

    get_context() { // HACK: workaround for DND since https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/3726
        return Clutter.Actor.prototype.get_context.call(this);
    }

    vfunc_repaint() {
        let cr = St.DrawingArea.prototype.get_context.call(this);
        let pl = PangoCairo.create_layout(cr);
        pl.set_font_description(this.$font);
        pl.set_text(this.$lrc, -1);
        let [w, h] = pl.get_pixel_size();
        this.$scroll = w > this.$size;
        this.$actual = this.$scroll ? this.$size : w; // actual pxiels
        this.$setupLayout(cr, pl, w, h, this.$scroll, this.$actual);
        this.$updateLayout(cr, pl, w, h, this.$scroll, this.$actual);

        cr.$dispose();
    }

    $updateLayout(cr, pl, w, h, scroll, L) {
        let offset = 0;
        if(this.$pos < 0) { // song title
            cr.setSourceRGBA(...this.homochromyColor);
            if(scroll) {
                let [slowness, delay, gap] = this.$title;
                offset = Math.min(0, delay - (this.moment / slowness) % (delay + w + gap));
                let round = offset + w + gap;
                if(round < L) {
                    cr.save();
                    this.$showLayout(cr, pl, round, h);
                    cr.restore();
                }
            }
        } else {
            if(scroll) offset = Math.clamp(L / 2 - w * this.$pos, L - w, 0);
            if(this[K.PRGR]) {
                cr.setSourceRGBA(...this.homochromyColor);
            } else {
                let pos = scroll ? (w * this.$pos + offset) / L : this.$pos;
                let gd = this.$genLinearGradient(L);
                gd.addColorStopRGBA(0, ...this.activeColor);
                gd.addColorStopRGBA(pos, ...this.activeColor);
                gd.addColorStopRGBA(pos, ...this.inactiveColor);
                gd.addColorStopRGBA(1, ...this.inactiveColor);
                cr.setSource(gd);
            }
        }
        this.$showLayout(cr, pl, offset, h);
    }

    $showLayout(cr, pl, x, _y) {
        cr.moveTo(x, 0);
        PangoCairo.show_layout(cr, pl);
    }

    $genLinearGradient(length) {
        return new Cairo.LinearGradient(0, 0, length, 0);
    }

    $clearLyric() {
        this.$len = 0;
        this.setLyrics(this.song = '');
        [this.$pos, this.$lrc] = this.getLyric();
    }

    getLyric(now = this.moment) {
        let index = findMaxLE(this.$tags, now);
        if(index < 0) return [-1, this.song];
        let key = this.$tags[index];
        let [len, lrc] = this.$lrcs.get(key);
        return [len > 0 ? (now - key) / len : 0, lrc];
    }

    clearLyric() {
        this.$clearLyric();
        this.queue_repaint();
    }

    setLength(len) {
        this.$len = len;
        if(!this.$lrcs.size) return;
        let end = this.$tags.at(-1);
        this.$lrcs.set(end, [Math.max(len - end, 0), this.$lrcs.get(end).at(-1)]);
    }

    setMoment(moment) {
        this.moment = moment;
        let {$pos, $lrc: $txt} = this;
        [this.$pos, this.$lrc] = this.getLyric();
        if(!this.visible || (!this.$scroll && (this.$pos === $pos || this[K.PRGR]) && this.$lrc === $txt)) return;
        this.queue_repaint();
    }

    setLyrics(lyrics) {
        this.$lrcs = lyrics.split(/\n/)
            .reduce((p, x) => {
                let i = x.lastIndexOf(']') + 1;
                if(i === 0) return p;
                let l = x.slice(i).trim();
                x.slice(0, i).match(/(?<=\[)[.:\d]+(?=])/g)?.forEach(t => p.push([time2ms(t), l]));
                return p;
            }, []).sort(([x], [y]) => x - y)
            .reduce((p, [t, l], i, a) => p.set(t, [(a[i + 1]?.[0] ?? Math.max(this.$len, t)) - t, l]), new Map());
        this.$tags = this.$lrcs.keys().toArray();
    }
}

export class Panel extends PaperBase {
    static {
        T.enrol(this);
    }

    constructor(tray, ...args) {
        super(...args);
        tray.$box.add_child(this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$set.tie(this, [[['$size', K.PNWD], x => this.set_width(x)]]);
    }

    $buildWidgets() {
        this.$src = F.Source.tie(this, F.Source.newHandler(Main.panel.statusArea.quickSettings,
            'style-changed', (() => this.$onStyleChange())[$].call()));
        super.$buildWidgets();
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node();
        let [w_, h] = Main.panel.get_size();
        this[$].$setFont(theme.get_font())[$]
            .inactiveColor(color2rgba(theme.get_foreground_color()))[$]
            .set_height(h)[$]
            .$onColorChange();
    }

    get homochromyColor() {
        return this.inactiveColor;
    }

    $onColorChange() {
        this.activeColor = color2rgba(F.theme().get_accent_color()[0]).map((x, i) => Util.lerp(x, this.inactiveColor[i], 0.2));
    }

    $setupLayout(cr, _pl, _w, h) {
        cr.translate(0, (this.get_surface_size()[1] - h) / 2);
    }
}

export class Desktop extends PaperBase {
    static {
        T.enrol(this);
        this.Decor = {OUTLINE: 0, BG: 1};
        this.Scale = 'text-scaling-factor';
    }

    constructor(drag, ...args) {
        super(...args).setDrag(drag);
    }

    $buildWidgets() {
        super.$buildWidgets();
        Main.uiGroup.add_child(this);
        this.$src = F.Source.tie(this, {drag: F.Source.new(() => this.#genDraggable())},
            F.Source.newHandler(F.theme(), 'notify::scale-factor', (() => this.$onFontSet())[$].call()));
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$setIF = new F.Setting('org.gnome.desktop.interface', this, [[Desktop.Scale, null, () => this.$onFontSet()]]);
        this.$set.tie(this, [
            K.DCTP, [K.FONT, null, () => this.$onFontSet()],
            [K.DCOP, x => x / 100, x => { this.decorColor[3] = x; }],
            [K.OPCT, x => x / 100, () => this.$onColorChange()],
        ], [K.ORNT, [K.SITE, x => { if(!this[K.SITE]) this.set_position(...x); }]], () => this.$onResize());
    }

    get homochromyColor() {
        return this.activeColor;
    }

    $onFontSet() {
        this.$setFont(Pango.FontDescription.from_string(this[K.FONT] ?? 'Sans 12')[$$](it =>
            it.set_size(it.get_size() * F.theme().scaleFactor * (this[Desktop.Scale] ?? 1))));
    }

    #genDraggable() {
        let border = F.Source.newInjector([this, {
            $setupLayout: (a, f, xs) => {
                let [cr] = xs;
                cr.save();
                cr.rectangle(0, 0, ...a.get_surface_size());
                cr.setSourceRGBA(1, 0, 0, 1);
                cr.setLineWidth(4);
                cr.stroke();
                cr.restore();
                f.apply(a, xs);
            },
        }], true);
        this.set_position(...global.get_pointer().slice(0, 2));
        return DND.makeDraggable(this)[$$](it => F.inject(it,
            'destroy', () => () => { border.destroy(); it._dragComplete(); },
            '_updateCursor', (o, f) => x => f.call(o, x === Clutter.CursorType.NO_DROP ? Clutter.CursorType.MOVE : x),
            '_dragActorDropped', () => () => {
                it.destroy();
                it._updateCursor(Clutter.CursorType.DEFAULT);
                this.$set[$s].set([[K.SITE, this.get_position()], [K.DRAG, false]]);
                return true;
            }));
    }

    setDrag(drag) {
        if(drag) Main.layoutManager.trackChrome(this);
        else Main.layoutManager.untrackChrome(this);
        this.set_reactive(drag);
        this.$src.drag.toggle(drag);
        Shell.util_set_hidden_from_pick(this, !drag);
    }

    $onResize() {
        let [w, h] = global.display.get_size();
        if(this[K.ORNT]) this.set_size(0.18 * w, this.$size = Math.max(0, h - this[K.SITE][1]));
        else this.set_size(this.$size = Math.max(0, w - this[K.SITE][0]), 0.3 * h);
    }

    $onColorChange() {
        [this.activeColor, this.inactiveColor] = F.theme().get_accent_color().map(x => color2rgba(x, this[K.OPCT]));
        this.decorColor = this.inactiveColor.map(x => 1 - x).with(3, this[K.DCOP]);
    }

    $genLinearGradient(length) {
        return this[K.ORNT] ? new Cairo.LinearGradient(0, 0, 0, length) : super.$genLinearGradient(length);
    }

    #drawBackground(cr, w, h) { // anti-clockwise rounded rectangle
        let P = Math.PI / 2; // right angle
        let r = Math.min(w, h) / 8;
        if(this[K.ORNT]) [w, h] = [h, w];
        this.$actual -= 2 * r;
        cr.translate(r, r);
        cr.newSubPath();
        cr.arcNegative(0, 0, r, - P, P * 2);
        cr.arcNegative(0, h, r, P * 2, P);
        cr.arcNegative(w, h, r, P, 0);
        cr.arcNegative(w, 0, r, 0, - P);
        cr.closePath();
        cr.setSourceRGBA(...this.decorColor);
        cr.fill();
    }

    $setupLayout(cr, pl, w_, h, s_, L) {
        if(this[K.DCOP] && this[K.DCTP] === Desktop.Decor.BG) this.#drawBackground(cr, L, h);
        if(this[K.ORNT]) pl.get_context().set_base_gravity(Pango.Gravity.EAST);
    }

    $showLayout(cr, pl, x, y) {
        if(this[K.ORNT]) {
            cr.moveTo(y, x);
            cr.rotate(Math.PI / 2);
            PangoCairo.show_layout(cr, pl);
        } else {
            super.$showLayout(cr, pl, x, y);
        }
        if(this[K.DCOP] && this[K.DCTP] === Desktop.Decor.OUTLINE) {
            PangoCairo.layout_path(cr, pl);
            cr.setSourceRGBA(...this.decorColor);
            cr.stroke();
        }
    }
}
