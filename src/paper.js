// SPDX-FileCopyrightText: tuberry
// SPDX-FileCopyrightText: NowLoadY
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Cogl from 'gi://Cogl';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import PangoCairo from 'gi://PangoCairo';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const {$, $_, $$} = T;

const RTA = Math.PI / 2; // right angle
const time2ms = time => Math.round(time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000); // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha}, opacity) => [red, green, blue].map(x => x / 255)[$].push(opacity || alpha / 255);

function parseColor(text) {
    let [ok, color] = Cogl.Color.from_string(text);
    if(ok) return color2rgba(color);
    let alpha = parseInt(text);
    return isNaN(alpha) ? 0 : Math.clamp(alpha / 100, 0, 1);
}

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
        super(param)[$].$clearLyric()[$].$bindSettings(set).$buildSources();
    }

    $bindSettings(set) {
        this.$set = set.tie(this, [[K.ICLR, parseColor], [K.ACLR, parseColor]], () => this.$onColorChange(),
            [K.PRGR], () => { this.$scroll = true; this.queue_repaint(); }); // NOTE: force redrawing
    }

    $buildSources() {
        F.Source.tie(this, F.Source.newHandler(F.theme(), 'changed', (() => this.$onColorChange())[$].call()));
    }

    $setFont(font) {
        this.$font = font;
        let ratio = font.get_size() / Pango.FontDescription.from_string('Sans 12').get_size();
        this.$title = [30 / ratio, 16 * 3 * ratio, 16 * 4 * ratio];
    }

    get_context() { // HACK: workaround for DND since https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/3726
        return Clutter.Actor.prototype.get_context.call(this);
    }

    vfunc_repaint() {
        let cr = St.DrawingArea.prototype.get_context.call(this);
        let pl = PangoCairo.create_layout(cr);
        this.$initLayout(pl);
        let [w, h] = pl.get_pixel_size();
        this.$scroll = w > this.$size;
        this.$actual = this.$scroll ? this.$size : w; // actual pxiels
        this.$setupLayout(cr, h);
        this.$updateLayout(cr, pl, w, h, this.$actual, this.$scroll);

        cr.$dispose();
    }

    $initLayout(pl) {
        pl.set_font_description(this.$font);
        pl.set_text(this.$lrc, -1);
    }

    $updateLayout(cr, pl, w, h, L, scroll) {
        let source;
        let offset = 0;
        if(this.$pos < 0) { // song title
            if(scroll) {
                let [slowness, delay, gap] = this.$title;
                offset = Math.min(0, delay - (this.moment / slowness) % (delay + w + gap));
                let round = offset + w + gap;
                if(round < L) {
                    cr.save();
                    this.$showLayout(cr, pl, source, round, h);
                    cr.restore();
                }
            }
        } else {
            if(scroll) offset = Math.clamp(L / 2 - w * this.$pos, L - w, 0);
            if(this[K.PRGR]) {
                let pos = scroll ? (w * this.$pos + offset) / L : this.$pos;
                source = new Cairo.LinearGradient(0, 0, L, 0);
                source.addColorStopRGBA(0, ...this.activeColor);
                source.addColorStopRGBA(pos, ...this.activeColor);
                source.addColorStopRGBA(pos, ...this.inactiveColor);
                source.addColorStopRGBA(1, ...this.inactiveColor);
            }
        } // need goto
        this.$showLayout(cr, pl, source, offset, h);
    }

    $showLayout(cr, pl, source) {
        if(source) cr.setSource(source);
        else cr.setSourceRGBA(...this.homochromyColor);
        PangoCairo.show_layout(cr, pl);
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
        let {$pos: pos, $lrc: lrc} = this;
        [this.$pos, this.$lrc] = this.getLyric();
        if(this.visible && (this.$scroll || (this[K.PRGR] && this.$pos !== pos) || this.$lrc !== lrc)) this.queue_repaint();
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
        this.QS = Main.panel.statusArea.quickSettings;
    }

    constructor(tray, ...args) {
        super(...args);
        tray.$box.add_child(this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$set.tie(this, [[['$size', K.PNWD], x => this.set_width(x)]]);
    }

    $buildSources() {
        this.$src = F.Source.tie(this, F.Source.newHandler(Panel.QS, 'style-changed', (() => this.$onStyleChange())[$].call()));
        super.$buildSources();
    }

    $onStyleChange() {
        this[$].$setFont(Panel.QS.get_theme_node().get_font())[$].set_height(Main.panel.get_size()[1]).$onColorChange();
    }

    get homochromyColor() {
        return this.inactiveColor;
    }

    $onColorChange() {
        let fgcolor = color2rgba(Panel.QS.get_theme_node().get_foreground_color());
        let blend = rgba => rgba.map((x, i, a) => x + (fgcolor[i] - x) * (1 - a[3])).with(3, 1);
        this.activeColor = blend(Array.isArray(this[K.ACLR]) ? this[K.ACLR] : color2rgba(F.theme().get_accent_color()[0], this[K.ACLR]));
        this.inactiveColor = Array.isArray(this[K.ICLR]) ? blend(this[K.ICLR]) : fgcolor;
    }

    $setupLayout(cr, h) {
        cr.translate(0, (this.get_surface_size()[1] - h) / 2);
    }

    $showLayout(cr, pl, source, x) {
        cr.moveTo(x, 0);
        super.$showLayout(cr, pl, source);
    }
}

export class Desktop extends PaperBase {
    static {
        T.enrol(this);
        this.Decor = {OUTLINE: 0, BG: 1};
        this.SCALE = 'text-scaling-factor';
    }

    constructor(drag, ...args) {
        super(...args).setDrag(drag);
        Main.uiGroup.add_child(this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$setIF = new F.Setting('org.gnome.desktop.interface', this, [[Desktop.SCALE, null, () => this.$onFontSet()]]);
        this.$set.tie(this, [
            K.DCTP, [K.FONT, null, () => this.$onFontSet()],
            [K.DCLR, parseColor, () => this.$onColorChange()],
        ], [K.ORNT, [K.SITE, x => { if(!this[K.SITE]) this.set_position(...x); }]], () => this.$onResize());
    }

    $buildSources() {
        super.$buildSources();
        this.$src = F.Source.tie(this, {drag: F.Source.new(() => this.$genDraggable())},
            F.Source.newHandler(F.theme(), 'notify::scale-factor', (() => this.$onFontSet())[$].call()));
    }

    get homochromyColor() {
        return this.activeColor;
    }

    $onFontSet() {
        this.$setFont(Pango.FontDescription.from_string(this[K.FONT] ?? 'Sans 12')[$_](it =>
            it.set_size(it.get_size() * F.theme().scaleFactor * (this[Desktop.SCALE] ?? 1))));
    }

    $genDraggable() {
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
        return DND.makeDraggable(this)[$_](it => T.inject(it,
            'destroy', () => () => { border.destroy(); it._dragComplete(); },
            '_updateCursor', (o, f) => x => f.call(o, x === Clutter.CursorType.NO_DROP ? Clutter.CursorType.MOVE : x),
            '_dragActorDropped', () => () => {
                it.destroy();
                it._updateCursor(Clutter.CursorType.DEFAULT);
                this.$set[$$].set([[K.SITE, this.get_position()], [K.DRAG, false]]);
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
        let accent = F.theme().get_accent_color();
        [this.activeColor, this.inactiveColor] = [K.ACLR, K.ICLR].map((k, i) => Array.isArray(this[k]) ? this[k] : color2rgba(accent[i], this[k] || 0.8));
        this.decorColor = Array.isArray(this[K.DCLR]) ? this[K.DCLR] : this.inactiveColor.map(x => 1 - x).with(3, this[K.DCLR]);
    }

    $initLayout(pl) {
        super.$initLayout(pl);
        if(this[K.ORNT]) pl.get_context().set_base_gravity(Pango.Gravity.EAST);
    }

    $setupLayout(cr, h) {
        if(this[K.DCLR] && this[K.DCTP] === Desktop.Decor.BG) {
            let w = this.$actual;
            let r = Math.min(w, h) / 8;
            if(this[K.ORNT]) [w, h] = [h, w];
            this.$actual -= 2 * r;
            cr.translate(r, r);
            cr.newSubPath();
            cr.arcNegative(0, 0, r, - RTA, Math.PI);
            cr.arcNegative(0, h, r, Math.PI, RTA);
            cr.arcNegative(w, h, r, RTA, 0);
            cr.arcNegative(w, 0, r, 0, - RTA);
            cr.closePath(); // anti-clockwise rounded rectangle
            cr.setSourceRGBA(...this.decorColor);
            cr.fill();
        }
    }

    $showLayout(cr, pl, source, x, y) {
        if(this[K.ORNT]) {
            cr.moveTo(y, x);
            cr.rotate(RTA);
        } else {
            cr.moveTo(x, 0);
        }
        if(this[K.DCLR] && this[K.DCTP] === Desktop.Decor.OUTLINE) {
            PangoCairo.layout_path(cr, pl);
            cr.setSourceRGBA(...this.decorColor);
            cr.strokePreserve();
        }
        super.$showLayout(cr, pl, source);
    }
}
