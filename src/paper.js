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
import {makeDraggable} from 'resource:///org/gnome/shell/ui/dnd.js';

import {Field} from './const.js';
import {pickle} from './util.js';
import {Setting, Source, connect, stageTheme} from './fubar.js';

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
        this.$buildWidgets();
        this.$bindSettings(set);
    }

    $buildWidgets() {
        this.$clearLyric();
        this.$onColorChange();
        connect(this, stageTheme(), 'changed', () => this.$onColorChange());
    }

    $bindSettings(set) {
        this.$set = set.attach({
            homochromy: [Field.PRGR, 'boolean', x => !x],
        }, this, () => { this.$lrc = ''; this.queue_repaint(); });
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
        if(!this.visible || (this.$pos === $pos || this.homochromy) && this.$lrc === $lrc) return;
        this.queue_repaint();
    }

    setText(text) {
        this.$text = text.split(/\n/)
            .flatMap(x => {
                let i = x.lastIndexOf(']') + 1;
                if(i === 0) return [];
                let l = x.slice(i).trim();
                return x.slice(0, i).match(/(?<=\[)[.:\d]+(?=])/g)?.map(t => [time2ms(t), l]) ?? [];
            })
            .sort(([x], [y]) => x - y)
            .reduce((p, [t, l], i, a) => p.set(t, [(a[i + 1]?.[0] ?? Math.max(this.$span, t)) - t, l]), new Map());
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
}

export class PanelPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    $buildWidgets() {
        super.$buildWidgets();
        this.$naturalWidth = 0;
        this.$onStyleChange();
        connect(this, Main.panel.statusArea.quickSettings, 'style-changed', () => this.$onStyleChange());
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node();
        this.$font = theme.get_font();
        this.inactiveColor = color2rgba(theme.get_foreground_color());
        let [w, h] = Main.panel.get_size();
        this.$maxWidth = w / 3;
        this.set_height(h);
    }

    get homochromyColor() {
        return this.inactiveColor;
    }

    $onColorChange() {
        this.activeColor = color2rgba(stageTheme().get_accent_color()[0]);
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

export class DesktopPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    $buildWidgets() {
        super.$buildWidgets();
        Main.uiGroup.add_child(this);
        connect(this, stageTheme(), 'notify::scale-factor', () => this.$onFontNamePut());
        this.$src = Source.fuse({drag: new Source(() => this.$genDraggable(), x => x?._dragComplete())}, this);
    }

    $bindSettings(set) {
        super.$bindSettings(set);
        this.$setIf = new Setting({
            scaling: ['text-scaling-factor', 'double'],
        }, 'org.gnome.desktop.interface', this, () => this.$onFontNamePut());
        this.$set.attach({
            drag:   [Field.DRAG, 'boolean', x => this.$onDragSet(x)],
            orient: [Field.ORNT, 'uint',    x => this.$onOrientSet(x)],
            place:  [Field.SITE, 'value',   x => x.deepUnpack(), x => this.set_position(...x)],
        }, this).attach({
            fontName: [Field.FONT, 'string'],
        }, this, () => this.$onFontNamePut());
    }

    get homochromyColor() {
        return this.activeColor;
    }

    $onColorChange() {
        [this.activeColor, this.inactiveColor] = stageTheme().get_accent_color().map(x => color2rgba(x, 128));
        this.outlineColor = this.inactiveColor.map(x => 1 - x).with(3, 0.2);
    }

    $onFontNamePut() {
        this.$font = Pango.FontDescription.from_string(this.fontName ?? 'Sans 11');
        this.$font.set_size(this.$font.get_size() * stageTheme().scaleFactor * (this.scaling ?? 1));
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

    $showLayout(cr, pl) {
        if(this.orient) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size().at(1), 0);
            cr.rotate(Math.PI / 2);
        }
        super.$showLayout(cr, pl);
        cr.setSourceRGBA(...this.outlineColor);
        PangoCairo.layout_path(cr, pl);
        cr.stroke();
    }
}
