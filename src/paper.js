// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Meta from 'gi://Meta';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {lerp} from 'resource:///org/gnome/shell/misc/util.js';
import {makeDraggable} from 'resource:///org/gnome/shell/ui/dnd.js';

import {Field} from './const.js';
import * as Util from './util.js';
import * as Fubar from './fubar.js';

const time2ms = time => Math.round(time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000); // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha}, alpha0) => [red, green, blue, alpha0 ?? alpha].map(x => x / 255);

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
        GObject.registerClass(this);
    }

    constructor(set, param) {
        super(param);
        this.#clearLyric();
        this.$buildWidgets();
        this.$bindSettings(set);
    }

    $bindSettings(set) {
        this.$set = set.attach({
            homochromy: [Field.PRGR, 'boolean', x => !x],
        }, this, () => { this.$lrc = `\u200b${this.$lrc}`; this.queue_repaint(); }); // NOTE: force redrawing
    }

    $buildWidgets() {
        Fubar.connect(this, Fubar.getTheme(), 'changed', Util.thunk(() => this.$onColorChange()));
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
        if(this.homochromy) {
            cr.setSourceRGBA(...this.homochromyColor);
        } else {
            let gd = this.orient ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
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
        if(!this.visible || (this.$pos === $pos || this.homochromy) && this.$lrc === $txt) return;
        this.queue_repaint();
    }

    setLyrics(lyrics) {
        this.$lrcs = lyrics.split(/\n/)
            .flatMap(x => {
                let i = x.lastIndexOf(']') + 1;
                if(i === 0) return [];
                let l = x.slice(i).trim();
                return x.slice(0, i).match(/(?<=\[)[.:\d]+(?=])/g)?.map(t => [time2ms(t), l]) ?? [];
            })
            .sort(([x], [y]) => x - y)
            .reduce((p, [t, l], i, a) => p.set(t, [(a[i + 1]?.[0] ?? Math.max(this.$len, t)) - t, l]), new Map());
        this.$tags = Array.from(this.$lrcs.keys());
    }
}

export class Panel extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    constructor(tray, ...args) {
        super(...args);
        tray.$box.add_child(this);
    }

    $buildWidgets() {
        this.$naturalWidth = 0;
        Fubar.connect(this, Main.panel.statusArea.quickSettings, 'style-changed', Util.thunk(() => this.$onStyleChange()));
        super.$buildWidgets();
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node();
        this.$font = theme.get_font();
        this.inactiveColor = color2rgba(theme.get_foreground_color());
        this.$onColorChange();
        let [w, h] = Main.panel.get_size();
        this.$maxWidth = w / 3;
        this.set_height(h);
    }

    get homochromyColor() {
        return this.inactiveColor;
    }

    $onColorChange() {
        this.activeColor = color2rgba(Fubar.getTheme().get_accent_color()[0]).map((x, i) => lerp(x, this.inactiveColor[i], 0.2));
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
        GObject.registerClass(this);
    }

    $buildWidgets() {
        super.$buildWidgets();
        Main.uiGroup.add_child(this);
        Fubar.connect(this, Fubar.getTheme(), 'notify::scale-factor', () => this.$onFontSet());
        this.$src = Fubar.Source.tie({drag: new Fubar.Source(() => this.$genDraggable(), x => x?._dragComplete())}, this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$setIf = new Fubar.Setting('org.gnome.desktop.interface', {
            scaling: ['text-scaling-factor', 'double'],
        }, this, null, () => this.$onFontSet());
        this.$set.attach({
            drag:   [Field.DRAG, 'boolean', x => this.$onDragSet(x)],
            orient: [Field.ORNT, 'uint',    x => this.$onOrientSet(x)],
            place:  [Field.SITE, 'value',   x => Util.seq(y => this.set_position(...y), x.deepUnpack(), null, true)],
        }, this).attach({
            fontName: [Field.FONT, 'string'],
        }, this, () => this.$onFontSet());
    }

    get homochromyColor() {
        return this.activeColor;
    }

    $onFontSet() {
        this.$font = Pango.FontDescription.from_string(this.fontName ?? 'Sans 11');
        this.$font.set_size(this.$font.get_size() * Fubar.getTheme().scaleFactor * (this.scaling ?? 1));
    }

    $genDraggable() {
        let drag = makeDraggable(this, {dragActorOpacity: 200});
        drag._dragActorDropped = () => {
            drag._dragComplete();
            global.display.set_cursor(Meta.Cursor.DEFAULT);
            this.$set.set('place', Util.pickle(this.get_position()), this);
            this.$set.set('drag', false, this);
            return true;
        };
        return drag;
    }

    $onDragSet(drag) {
        if(drag === this.drag) return;
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
        [this.activeColor, this.inactiveColor] = Fubar.getTheme().get_accent_color().map(x => color2rgba(x, 128));
        this.outlineColor = this.inactiveColor.map(x => 1 - x).with(3, 0.2);
    }

    $showLayout(cr, pl) {
        if(this.orient) {
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
