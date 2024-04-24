// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Meta from 'gi://Meta';
import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import PangoCairo from 'gi://PangoCairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {makeDraggable} from 'resource:///org/gnome/shell/ui/dnd.js';

import {Field} from './const.js';
import {homolog, pickle} from './util.js';
import {Setting, Source, degrade, connect} from './fubar.js';

const time2ms = time => time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000; // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha}, alpha0) => [red, green, blue, alpha0 ?? alpha].map(x => x / 255);
const str2color = (vaule, fallback) => color2rgba(Clutter.Color.from_string(vaule).reduce((p, x) => p && x) || Clutter.Color.from_string(fallback).at(1));

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
        this.$clearLyric();
        this.$bindSettings(set);
    }

    $bindSettings(set) {
        this.$set = set.attach({
            acolor: [Field.ACLR, 'string', x => str2color(x, '#643296')],
            icolor: [Field.ICLR, 'string', x => str2color(x, '#f5f5f5')],
        }, this, () => this.$onColorPut());
    }

    $onColorPut() {
        this.$homochromy = homolog(this.icolor, this.acolor);
    }

    setSpan(span) {
        this.$span = span;
        if(!this.$text.size) return;
        let end = this.$tags.at(-1);
        this.$text.set(end, [Math.max(span - end, 0), this.$text.get(end).at(-1)]);
    }

    setMoment(moment) {
        this.moment = moment;
        let {$pos, $lrc} = this;
        [this.$pos, this.$lrc] = this.getLyric();
        if(!this.visible || (this.$pos === $pos || this.$homochromy) && this.$lrc === $lrc) return;
        this.queue_repaint();
    }

    setText(text) {
        this.$text = new Map(text.split(/\n/)
            .flatMap(x => (i => i > 0 ? [[x.slice(0, i), x.slice(i).trim()]] : [])(x.lastIndexOf(']') + 1))
            .flatMap(([t, l]) => t.match(/(?<=\[)[.:\d]+(?=])/g)?.map(x => [Math.round(time2ms(x)), l]) ?? [])
            .sort(([x], [y]) => x - y)
            .map(([t, l], i, a) => [t, [(a[i + 1]?.[0] ?? Math.max(this.$span, t)) - t, l]]));
        this.$tags = Array.from(this.$text.keys());
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

    $clearLyric() {
        this.$span = 0;
        this.setText(this.song = '');
        [this.$pos, this.$lrc] = this.getLyric();
    }

    clearLyric() {
        this.$clearLyric();
        this.queue_repaint();
    }

    getLyric(now = this.moment) {
        let index = findMaxLE(this.$tags, now);
        if(index < 0) return [0, this.song];
        let key = this.$tags[index];
        let [len, lrc] = this.$text.get(key);
        return [len > 0 ? (now - key) / len : 1, lrc];
    }

    $setupLayout(_cr, _h, pl) {
        pl.set_font_description(this.$font);
        pl.set_text(this.$lrc, -1);
    }

    $colorLayout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        let gd = this.orient ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
        gd.addColorStopRGBA(0, ...this.acolor);
        gd.addColorStopRGBA(this.$pos, ...this.acolor);
        gd.addColorStopRGBA(this.$pos, ...this.icolor);
        gd.addColorStopRGBA(1, ...this.icolor);
        cr.moveTo(Math.min(w - this.$pos * pw, 0), 0);
        cr.setSource(gd);
    }

    $showLayout(cr, pl) {
        PangoCairo.show_layout(cr, pl);
    }
}

export class PanelPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    $bindSettings(set) {
        this.$natural_width = 0;
        super.$bindSettings(set);
        connect(this, Main.panel.statusArea.quickSettings, 'style-changed', () => this.$onStyleChange());
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node(),
            fgcolor = theme.get_foreground_color(),
            [hue,, saturation] = Clutter.Color.new(...this.acolor?.map(x => x * 255) ?? Array(4).fill(255)).to_hls(),
            color = Clutter.Color.from_hls(hue, fgcolor.to_hls().at(1) > 0.5 ? 0.6 : 0.4, saturation);
        this.acolor = color2rgba(color, fgcolor.alpha);
        this.icolor = this.$homochromy ? this.acolor : color2rgba(fgcolor);
        this.$font = theme.get_font();
        let [w, h] = Main.panel.get_size();
        this.$max_width = w / 4;
        this.set_height(h);
    }

    $onColorPut() {
        super.$onColorPut();
        this.$onStyleChange();
    }

    setMoment(moment) {
        super.setMoment(moment);
        this.set_width(Math.min(this.$max_width, this.$natural_width + 4));
    }

    $setupLayout(cr, h, pl) {
        super.$setupLayout(cr, h, pl);
        let [pw, ph] = pl.get_pixel_size();
        this.$natural_width = pw;
        cr.translate(0, (h - ph) / 2);
    }
}

export class DesktopPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    $buildWidgets() {
        Main.uiGroup.add_child(this);
        this.$src = degrade({drag: new Source(() => this.$genDraggable(), x => x?._dragComplete())}, this);
        connect(this, St.ThemeContext.get_for_stage(global.stage), 'notify::scale-factor', () => this.$onFontPut());
    }

    $bindSettings(set) {
        this.$buildWidgets();
        super.$bindSettings(set);
        this.$set_if = new Setting({
            scaling: ['text-scaling-factor', 'double'],
        }, 'org.gnome.desktop.interface', this, () => this.$onFontPut());
        this.$set.attach({
            drag:   [Field.DRAG, 'boolean', x => this.$onDragSet(x)],
            orient: [Field.ORNT, 'uint',    x => this.$onOrientSet(x)],
            ocolor: [Field.OCLR, 'string',  x => str2color(x, '#000F')],
            place:  [Field.SITE, 'value',   x => x.deepUnpack(), x => this.set_position(...x)],
        }, this).attach({
            font:   [Field.FONT, 'string'],
        }, this, () => this.$onFontPut());
    }

    $onFontPut() {
        let factor = St.ThemeContext.get_for_stage(global.stage).scaleFactor;
        this.$font = Pango.FontDescription.from_string(this.font ?? 'Sans 11');
        this.$font.set_size(this.$font.get_size() * factor * (this.scaling ?? 1));
    }

    $genDraggable() {
        let draggable = makeDraggable(this, {dragActorOpacity: 200});
        draggable._dragActorDropped = () => {
            draggable._dragComplete();
            global.display.set_cursor(Meta.Cursor.DEFAULT);
            this.$set.set('place', pickle(this.get_position()), this);
            this.$set.set('drag', false, this);
            return true;
        };
        return draggable;
    }

    $onDragSet(drag) {
        if(drag === this.drag) return;
        if(drag) {
            Main.layoutManager.trackChrome(this);
            this.set_style('border: 0.2em blue;');
        } else {
            Main.layoutManager.untrackChrome(this);
            this.set_style('');
        }
        this.reactive = drag;
        this.$src.drag.toggle(drag);
        Shell.util_set_hidden_from_pick(this, !drag);
    }

    $onOrientSet(orient) {
        let [w, h] = global.display.get_size();
        orient ? this.set_size(0.18 * w, h) : this.set_size(w, 0.3 * h);
    }

    $showLayout(cr, pl) {
        if(this.orient) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size().at(1), 0);
            cr.rotate(Math.PI / 2);
        }
        super.$showLayout(cr, pl);
        if(this.ocolor[3] > 0) {
            cr.setSourceRGBA(...this.ocolor);
            PangoCairo.layout_path(cr, pl);
            cr.stroke();
        }
    }
}
