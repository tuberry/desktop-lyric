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

    constructor(gset, $surface) {
        super()[$].$clearLyric()[$].$bindSettings(gset)[$].$buildSources()[$].set({$surface}).$sync({font: true, color: true});
    }

    $bindSettings(gset) {
        this.$set = gset.tie(this, [K.PRGR], null, () => this.$sync(),
            [[K.ICLR, parseColor], [K.ACLR, parseColor]], null, () => this.$sync({color: true}));
    }

    $buildSources() {
        F.Source.tie(this, new F.Source.Handler(F.theme(), 'changed', () => this.$sync({color: true})));
    }

    get homochromy() { return !this[K.PRGR] || this.$pos < 0; }

    $updateSurfaces() {
        let pl = this.$genLayout(this.$lrc);
        let [w, h] = pl.get_pixel_size();
        Object.assign(this.$surface, {W: w, H: h, active: this.$genSurface(true, pl, w, h), inactive: this.$genSurface(false, pl,  w, h)});
        this.$syncSize();
    }

    $syncSize() {
        this.$surface.L = Math.min(this.$size, this.$surface.W); // actual pxiels
        this.$surface.SCROLL = this.$surface.W > this.$size;
    }

    $sync({font, color} = {}) {
        if(font) this.$syncFont();
        if(color) this.$syncColor();
        this.$updateSurfaces();
        this.queue_repaint();
    }

    $setFont(font, scale = 1) {
        this.$font = scale ? font : font[$].set_size(font.get_size() * scale);
        let ratio = font.get_size() / Pango.SCALE / 12;
        this.$title = {slowness: 30 / ratio, delay: 3 * 16 * ratio, gap: 4 * 16 * ratio};
    }

    get_context() { // HACK: workaround for DND since https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/3726
        return Clutter.Actor.prototype.get_context.call(this);
    }

    vfunc_repaint() {
        let cr = St.DrawingArea.prototype.get_context.call(this);
        this.$transform(cr);
        this.$composite(cr);

        cr.$dispose();
    }

    $genImageSurface(w = 1, h = 1) {
        let scale = this.get_resource_scale();
        let ret = new Cairo.ImageSurface(Cairo.Format.ARGB32, w * scale, h * scale);
        ret.setDeviceScale(scale, scale);
        return ret;
    }

    $genLayout() {
        let sf = this.$genImageSurface(),
            cr = new Cairo.Context(sf),
            ret = PangoCairo.create_layout(cr);
        ret.set_font_description(this.$font);
        ret.set_text(this.$lrc, -1);

        cr.$dispose(); // NOTE: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using

        return ret;
    }

    $composite(cr) {
        let offset = 0;
        let {homochromy, W, H, L, SCROLL} = this.$surface;
        if(this.$pos < 0) { // song title
            if(SCROLL) {
                let {slowness, delay, gap} = this.$title;
                offset = Math.min(0, delay - (this.moment / slowness) % (delay + W + gap));
                let round = offset + W + gap;
                if(round < L) {
                    cr.setSourceSurface(homochromy, Math.round(round), 0);
                    cr.paint();
                }
            }
        } else {
            if(SCROLL) offset = Math.clamp(L / 2 - W * this.$pos, L - W, 0);
            if(this[K.PRGR]) {
                let pos = Math.round(SCROLL ? W * this.$pos + offset : this.$pos * L);
                cr.rectangle(0, 0, pos, H);
                cr.setSourceSurface(this.$surface.active, Math.round(offset), 0);
                cr.fill();
                cr.rectangle(pos, 0, L - pos, H);
                cr.setSourceSurface(this.$surface.inactive, Math.round(offset), 0);
                cr.fill();
                return;
            }
        }
        cr.setSourceSurface(homochromy, Math.round(offset), 0);
        cr.paint();
    }

    $clearLyric() {
        this.$len = this.$pos = 0;
        this.setLyrics(this.song = this.$lrc = '');
    }

    clearLyric() {
        this.$clearLyric();
        this.$sync();
    }

    setMoment(moment) {
        this.moment = moment;
        if(!this.visible) return;
        let {$pos: pos, $lrc: lrc} = this;
        [this.$pos, this.$lrc] = this.getLyric();
        if(this.$lrc !== lrc) this.$sync();
        else if(this.$surface.SCROLL || (this[K.PRGR] && this.$pos !== pos)) this.queue_repaint();
    }

    getLyric(now = this.moment) {
        let index = findMaxLE(this.$tags, now);
        if(index < 0) return [-1, this.song];
        let key = this.$tags[index];
        let [len, lrc] = this.$lrcs.get(key);
        return [len > 0 ? (now - key) / len : 0, lrc];
    }

    setLength(len) {
        this.$len = len;
        if(!this.$lrcs.size) return;
        let end = this.$tags.at(-1);
        this.$lrcs.set(end, [Math.max(len - end, 0), this.$lrcs.get(end).at(-1)]);
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
            .reduce((p, [t, l], i, a) => p.set(t, [(a[i + 1]?.[0] ?? Math.max(this.$len ?? 0, t)) - t, l]), new Map());
        this.$tags = this.$lrcs.keys().toArray();
    }
}

export class Panel extends PaperBase {
    static {
        T.enrol(this);
        this.QS = Main.panel.statusArea.quickSettings;
    }

    constructor(tray, set) {
        super(set, {get homochromy() { return this.inactive; }})
            .add_constraint(new Clutter.BindConstraint({coordinate: Clutter.BindCoordinate.HEIGHT, source: Main.panel}));
        tray.$box.add_child(this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$set.tie(this, [[['$size', K.PNWD], x => this.set_width(x), () => this.$syncSize()]]);
    }

    $buildSources() {
        this.$src = F.Source.tie(this, new F.Source.Handler(Panel.QS, 'style-changed', () => this.$sync({font: true, color: true})));
        super.$buildSources();
    }

    $genSurface(active, layout, w, h) {
        if(this.homochromy && active) return;
        let ret = this.$genImageSurface(w, h);
        let cr = new Cairo.Context(ret);
        cr.setSourceRGBA(...active ? this.activeColor : this.inactiveColor);
        PangoCairo.show_layout(cr, layout);

        cr.$dispose();

        return ret;
    }

    $syncFont() {
        this.$setFont(Panel.QS.get_theme_node().get_font());
    }

    $syncColor() {
        let fgcolor = color2rgba(Panel.QS.get_theme_node().get_foreground_color());
        let blend = rgba => rgba.map((x, i, a) => x + (fgcolor[i] - x) * (1 - a[3])).with(3, 1);
        this.activeColor = blend(Array.isArray(this[K.ACLR]) ? this[K.ACLR] : color2rgba(F.theme().get_accent_color()[0], this[K.ACLR]));
        this.inactiveColor = Array.isArray(this[K.ICLR]) ? blend(this[K.ICLR]) : fgcolor;
    }

    $transform(cr) {
        cr.translate(0, Math.round((this.get_surface_size()[1] - this.$surface.H) / 2));
    }
}

export class Desktop extends PaperBase {
    static {
        T.enrol(this);
        this.SCALE = 'text-scaling-factor';
        this.Decor = {NONE: -1, OUTLINE: 0, BG: 1};
    }

    constructor(drag, gset) {
        super(gset, {get homochromy() { return this.active; }}).setDrag(drag);
        Main.uiGroup.add_child(this);
    }

    $bindSettings(gset) {
        super.$bindSettings(gset);
        this.$setIF = new F.Setting('org.gnome.desktop.interface').tie(this, [[Desktop.SCALE, null, () => this.$sync({font: true})]]);
        this.$set.tie(this, [[K.FONT, null, () => this.$sync({font: true})]],
            [K.ORNT, [K.SITE, x => { if(!this[K.SITE]) this.set_position(...x); }]], () => this.$onResize(), () => this.$sync(),
            [K.DCTP, [K.DCLR, parseColor, () => this.$syncColor()]], () => { this.$decor = this[K.DCLR] ? this[K.DCTP] : Desktop.Decor.NONE; }, () => this.$sync());
    }

    $buildSources() {
        super.$buildSources();
        this.$src = F.Source.tie(this, {drag: new F.Source(() => this.$genDraggable())},
            new F.Source.Handler(F.theme(), 'notify::scale-factor', () => this.$onFontSet()));
    }

    $genDraggable() {
        let offset = 0;
        let border = new F.Source.Injector([this, {
            $transform: (a, f, xs) => {
                let [cr] = xs;
                cr.save();
                cr.setDash([11, 5], this.$src.drag.hub._grab ? offset : offset = (offset + 1) % 16);
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
        let {width: w, height: h} = Main.layoutManager.findMonitorForActor(this);
        if(this[K.ORNT]) this.set_size(0.18 * w, this.$size = Math.max(0, h - this[K.SITE][1]));
        else this.set_size(this.$size = Math.max(0, w - this[K.SITE][0]), 0.3 * h);
    }

    $syncFont() {
        this.$setFont(Pango.FontDescription.from_string(this[K.FONT] || 'Sans 12'), F.theme().scaleFactor * (this[Desktop.SCALE] ?? 1));
    }

    $syncColor() {
        let accent = F.theme().get_accent_color();
        [this.activeColor, this.inactiveColor] = [K.ACLR, K.ICLR].map((k, i) => Array.isArray(this[k]) ? this[k] : color2rgba(accent[i], this[k] || 0.8));
        this.decorColor = Array.isArray(this[K.DCLR]) ? this[K.DCLR] : this.inactiveColor.map(x => 1 - x).with(3, this[K.DCLR]);
    }

    $genLayout() {
        let ret = super.$genLayout();
        if(this[K.ORNT]) ret.get_context().set_base_gravity(Pango.Gravity.EAST);
        return ret;
    }

    $genSurface(active, layout, w, h) {
        if(this.homochromy && !active) return;
        let ret = this.$genImageSurface(w, h);
        let cr = new Cairo.Context(ret);
        if(this.$decor === Desktop.Decor.OUTLINE) {
            PangoCairo.layout_path(cr, layout);
            cr.setSourceRGBA(...this.decorColor);
            cr.stroke();
        }
        cr.setSourceRGBA(...active ? this.activeColor : this.inactiveColor);
        PangoCairo.show_layout(cr, layout);

        cr.$dispose();

        return ret;
    }

    $updateSurfaces() {
        super.$updateSurfaces();
        if(this.$decor === Desktop.Decor.BG) {
            let {W: l, H: h} = this.$surface,
                r = this.$surface.R = Math.floor(Math.min(l, h) / 8),
                w = this.$surface.L = Math.min(l, this.$size - 2 * r);
            if(this[K.ORNT]) [w, h] = [h, w];
            this.$surface.SCROLL = w < l;
            let cr = new Cairo.Context(this.$surface.bg = this.$genImageSurface(w + 2 * r, h + 2 * r));
            cr.translate(r, r);
            cr.newSubPath();
            cr.arcNegative(0, 0, r, - RTA, Math.PI);
            cr.arcNegative(0, h, r, Math.PI, RTA);
            cr.arcNegative(w, h, r, RTA, 0);
            cr.arcNegative(w, 0, r, 0, - RTA);
            cr.closePath(); // anti-clockwise rounded rectangle
            cr.setSourceRGBA(...this.decorColor);
            cr.fill();

            cr.$dispose();
        } else {
            this.$surface.bg = null;
        }
    }

    $transform(cr) {
        if(this.$decor === Desktop.Decor.BG) {
            cr.setSourceSurface(this.$surface.bg, 0, 0);
            cr.paint();
            cr.translate(this.$surface.R, this.$surface.R);
        }
        if(this[K.ORNT]) {
            cr.translate(this.$surface.H, 0);
            cr.rotate(RTA);
        }
    }
}
