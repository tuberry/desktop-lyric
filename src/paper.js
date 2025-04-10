// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Meta from 'gi://Meta';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import PangoCairo from 'gi://PangoCairo';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MiscUtil from 'resource:///org/gnome/shell/misc/util.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const time2ms = time => Math.round(time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000); // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha = 255}, opacity) => [red, green, blue].map(x => x / 255).concat(opacity ?? alpha / 255);

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
        super(param);
        this.#clearLyric();
        this.$bindSettings(set);
        this.$buildWidgets();
    }

    $bindSettings(set) {
        this.$set = set.tie([[K.PRGR, x => !x]], this, () => { this.$lrc = `\u{200b}${this.$lrc}`; this.queue_repaint(); }); // NOTE: force redrawing
    }

    $buildWidgets() {
        F.connect(this, F.theme(), 'changed', T.thunk(() => this.$onColorChange()));
    }

    vfunc_repaint() {
        let cr = this.get_context(),
            [w, h] = this.get_surface_size(),
            pl = PangoCairo.create_layout(cr);
        this.$setupLayout(cr, h, pl);
        this.$colorLayout(cr, w, pl);
        this.$showLayout(cr, pl);

        cr.$dispose();
    }

    #clearLyric() {
        this.$len = 0;
        this.setLyrics(this.song = '');
        [this.$pos, this.$lrc] = this.getLyric();
    }

    getLyric(now = this.moment) {
        let index = findMaxLE(this.$tags, now);
        if(index < 0) return [0, this.song];
        let key = this.$tags[index];
        let [len, lrc] = this.$lrcs.get(key);
        return [len > 0 ? (now - key) / len : 0, lrc];
    }

    $setupLayout(_cr, _h, pl) {
        pl.set_font_description(this.$font);
        pl.set_text(this.$lrc, -1);
    }

    $colorLayout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        cr.moveTo(pw > w ? this.$pos * (w - pw) : 0, 0);
        if(this[K.PRGR]) {
            cr.setSourceRGBA(...this.homochromyColor);
        } else {
            let gd = this[K.ORNT] ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
            gd.addColorStopRGBA(0, ...this.activeColor);
            gd.addColorStopRGBA(this.$pos, ...this.activeColor);
            gd.addColorStopRGBA(this.$pos, ...this.inactiveColor);
            gd.addColorStopRGBA(1, ...this.inactiveColor);
            cr.setSource(gd);
        }
    }

    $showLayout(cr, pl) {
        PangoCairo.show_layout(cr, pl);
    }

    clearLyric() {
        this.#clearLyric();
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
        if(!this.visible || (this.$pos === $pos || this[K.PRGR]) && this.$lrc === $txt) return;
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
        this.$tags = Array.from(this.$lrcs.keys());
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

    $buildWidgets() {
        F.connect(this, Main.panel.statusArea.quickSettings, 'style-changed', T.thunk(() => this.$onStyleChange()));
        this.$naturalWidth = 0;
        super.$buildWidgets();
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node();
        this.$font = theme.get_font();
        this.inactiveColor = color2rgba(theme.get_foreground_color());
        let [w, h] = Main.panel.get_size();
        this.$maxWidth = w / 3;
        this.set_height(h);
        this.$onColorChange();
    }

    get homochromyColor() {
        return this.inactiveColor;
    }

    $onColorChange() {
        this.activeColor = color2rgba(F.theme().get_accent_color()[0]).map((x, i) => MiscUtil.lerp(x, this.inactiveColor[i], 0.2));
    }

    setMoment(moment) {
        super.setMoment(moment);
        this.set_width(Math.min(this.$maxWidth, this.$naturalWidth + 4));
    }

    $setupLayout(cr, h, pl) {
        super.$setupLayout(cr, h, pl);
        let [pw, ph] = pl.get_pixel_size();
        this.$naturalWidth = pw;
        cr.translate(0, (h - ph) / 2);
    }
}

export class Desktop extends PaperBase {
    static {
        T.enrol(this);
    }

    constructor(drag, ...args) {
        super(...args);
        this.setDrag(drag);
    }

    $buildWidgets() {
        super.$buildWidgets();
        Main.uiGroup.add_child(this);
        F.connect(this, F.theme(), 'notify::scale-factor', T.thunk(() => this.$onFontSet()));
        this.$src = F.Source.tie({drag: new F.Source(() => this.$genDraggable(), x => x._dragComplete())}, this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$setIF = new F.Setting('org.gnome.desktop.interface', [
            [['scaling', 'text-scaling-factor']],
        ], this, null, () => this.$onFontSet());
        this.$set.tie([
            [K.ORNT, x => this.$onOrientSet(x)],
            [K.OPCT, x => x / 100, () => this.$onColorChange()],
            [K.SITE, x => T.seq(y => this.set_position(...y), x), null, true],
        ], this).tie([K.FONT], this, null, () => this.$onFontSet());
    }

    get homochromyColor() {
        return this.activeColor;
    }

    $onFontSet() {
        this.$font = Pango.FontDescription.from_string(this[K.FONT] ?? 'Sans 11');
        this.$font.set_size(this.$font.get_size() * F.theme().scaleFactor * (this.scaling ?? 1));
    }

    $genDraggable() {
        let ret = DND.makeDraggable(this, {dragActorOpacity: 200});
        ret._dragActorDropped = () => {
            ret._dragComplete();
            global.display.set_cursor(Meta.Cursor.DEFAULT);
            this.$set.set(K.SITE, this.get_position());
            this.$set.set(K.DRAG, false);
            return true;
        };
        return ret;
    }

    setDrag(drag) {
        if(drag) Main.layoutManager.trackChrome(this);
        else Main.layoutManager.untrackChrome(this);
        this.reactive = drag;
        this.$src.drag.toggle(drag);
        Shell.util_set_hidden_from_pick(this, !drag);
    }

    $onOrientSet(orient) {
        let [w, h] = global.display.get_size();
        orient ? this.set_size(0.18 * w, h) : this.set_size(w, 0.3 * h);
    }

    $onColorChange() {
        [this.activeColor, this.inactiveColor] = F.theme().get_accent_color().map(x => color2rgba(x, this[K.OPCT]));
        this.outlineColor = this.inactiveColor.map(x => 1 - x).with(3, 0.2);
    }

    $showLayout(cr, pl) {
        if(this[K.ORNT]) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size().at(1), 0);
            cr.rotate(Math.PI / 2);
        }
        super.$showLayout(cr, pl);
        PangoCairo.layout_path(cr, pl);
        cr.setSourceRGBA(...this.outlineColor);
        cr.stroke();
    }
}
