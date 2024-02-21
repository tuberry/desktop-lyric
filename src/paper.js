// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import GLib from 'gi://GLib';
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
import {xnor, has} from './util.js';
import {Fulu, connect} from './fubar.js';

const t2ms = time => time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000; // '1:1' => 61000 ms
const c2rgba = ({red, green, blue, alpha}, alpha0) => [red, green, blue, alpha0 ?? alpha].map(x => x / 255);

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

    constructor(fulu) {
        super();
        this._clearLyric();
        this._bindSettings(fulu);
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            acolor: [Field.ACLR, 'string', '#643296'],
            icolor: [Field.ICLR, 'string', '#f5f5f5'],
        }, this, 'color');
    }

    set span(span) {
        this._span = span;
        if(!this._text.size) return;
        let end = this._tags.at(-1);
        this._text.set(end, [Math.max(span - end, 0), this._text.get(end).at(-1)]);
    }

    set color([k, v, fallback]) {
        this[k] = Clutter.Color.from_string(v).reduce((p, x) => p && x) || Clutter.Color.from_string(fallback).at(1);
        if(has(this, 'acolor', 'icolor')) this._homochromy = this.acolor.equal(this.icolor);
        this[`_${k}`] = c2rgba(this[k]);
    }

    set moment(moment) {
        this._moment = moment;
        let {_pos, _lrc} = this;
        [this._pos, this._lrc] = this.getLyric();
        if(!this.visible || (this._pos === _pos || this._homochromy) && this._lrc === _lrc) return;
        this.queue_repaint();
    }

    set text(text) {
        this._text = new Map(text.split(/\n/)
            .flatMap(x => (i => i > 0 ? [[x.slice(0, i), x.slice(i).trim()]] : [])(x.lastIndexOf(']') + 1))
            .flatMap(([t, l]) => t.match(/(?<=\[)[.:\d]+(?=])/g)?.map(x => [Math.round(t2ms(x)), l]) ?? [])
            .sort(([x], [y]) => x - y)
            .map(([t, l], i, a) => [t, [(a[i + 1]?.[0] ?? Math.max(this._span, t)) - t, l]]));
        this._tags = Array.from(this._text.keys());
    }

    vfunc_repaint() {
        let cr = this.get_context(),
            [w, h] = this.get_surface_size(),
            pl = PangoCairo.create_layout(cr);
        this._setupLayout(cr, h, pl);
        this._colorLayout(cr, w, pl);
        this._showLayout(cr, pl);
        cr.$dispose();
    }

    _clearLyric() {
        this._span = 0;
        this.text = this.song = '';
        [this._pos, this._lrc] = this.getLyric();
    }

    clearLyric() {
        this._clearLyric();
        this.queue_repaint();
    }

    getLyric(now = this._moment) {
        let index = findMaxLE(this._tags, now);
        if(index < 0) return [0, this.song];
        let key = this._tags[index];
        let [len, lrc] = this._text.get(key);
        return [len > 0 ? (now - key) / len : 1, lrc];
    }

    _setupLayout(_cr, _h, pl) {
        pl.set_font_description(this._font);
        pl.set_text(this._lrc, -1);
    }

    _colorLayout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        let gd = this._orient ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
        gd.addColorStopRGBA(0, ...this._acolor);
        gd.addColorStopRGBA(this._pos, ...this._acolor);
        gd.addColorStopRGBA(this._pos, ...this._icolor);
        gd.addColorStopRGBA(1, ...this._icolor);
        cr.moveTo(Math.min(w - this._pos * pw, 0), 0);
        cr.setSource(gd);
    }

    _showLayout(cr, pl) {
        PangoCairo.show_layout(cr, pl);
    }
}

export class PanelPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    _bindSettings(fulu) {
        this._natural_width = 0;
        super._bindSettings(fulu);
        connect(this, [Main.panel.statusArea.quickSettings, 'style-changed', () => this._onStyleChange()]);
    }

    _onStyleChange() {
        if(!has(this, 'acolor', 'icolor')) return;
        let theme = Main.panel.statusArea.quickSettings.get_theme_node(),
            fg = theme.get_foreground_color(),
            [hue,, s] = this.acolor.to_hls(),
            color = Clutter.Color.from_hls(hue, fg.to_hls().at(1) > 0.5 ? 0.6 : 0.4, s);
        this._acolor = c2rgba(color, fg.alpha);
        this._icolor = this._homochromy ? this._acolor : c2rgba(fg);
        this._font = theme.get_font();
        let [w, h] = Main.panel.get_size();
        this._max_width = w / 4;
        this.set_height(h);
    }

    set color(color) {
        super.color = color;
        this._onStyleChange();
    }

    set moment(moment) {
        super.moment = moment;
        this.set_width(Math.min(this._max_width, this._natural_width + 4));
    }

    _setupLayout(cr, h, pl) {
        super._setupLayout(cr, h, pl);
        let [pw, ph] = pl.get_pixel_size();
        this._natural_width = pw;
        cr.translate(0, (h - ph) / 2);
    }
}

export class DesktopPaper extends PaperBase {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super(gset);
        Main.layoutManager.addTopChrome(this);
        this.set_position(...this.place.deepUnpack());
        connect(this, [St.ThemeContext.get_for_stage(global.stage), 'notify::scale-factor', () => { this.font = []; }]);
    }

    _bindSettings(fulu) {
        super._bindSettings(fulu);
        this._fulu_if = new Fulu({
            scaling: ['text-scaling-factor', 'double'],
        }, 'org.gnome.desktop.interface', this, 'font');
        this._fulu.attach({
            drag:   [Field.DRAG, 'boolean'],
            orient: [Field.ORNT, 'uint'],
            font:   [Field.FONT, 'string'],
            place:  [Field.SITE, 'value'],
        }, this).attach({
            ocolor: [Field.OCLR, 'string'],
        }, this, 'color').attach({
            fontname: [Field.FONT, 'string'],
        }, this, 'font');
    }

    set font([k, v]) {
        if(k) this[k] = v;
        if(!has(this, 'fontname', 'scaling')) return;
        let factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._font = Pango.FontDescription.from_string(this.fontname);
        this._font.set_size(this._font.get_size() * this.scaling * factor);
    }

    set drag(drag) {
        this.reactive = drag;
        Shell.util_set_hidden_from_pick(this, !drag);
        if(xnor(drag, this._drag)) return;
        if((this._drag = drag)) {
            Main.layoutManager.trackChrome(this);
            let draggable = makeDraggable(this, {dragActorOpacity: 200});
            draggable._dragActorDropped = event => {
                draggable._dragCancellable = false;
                draggable._dragComplete(); // emit after this to assure hidden
                global.display.set_cursor(Meta.Cursor.DEFAULT);
                draggable.emit('drag-end', event.get_time(), true);
                return true;
            }; // override for moving only
            draggable.connect('drag-end', () => this._fulu.set('drag', false, this));
        } else {
            Main.layoutManager.untrackChrome(this);
            this._fulu.set('place', new GLib.Variant('(uu)', this.get_position()), this);
        }
    }

    set orient(orient) {
        this._orient = orient;
        let [w, h] = global.display.get_size();
        orient ? this.set_size(0.18 * w, h) : this.set_size(w, 0.3 * h);
    }

    _showLayout(cr, pl) {
        if(this._orient) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size().at(1), 0);
            cr.rotate(Math.PI / 2);
        }
        super._showLayout(cr, pl);
        if(this._ocolor[3] > 0) {
            cr.setSourceRGBA(...this._ocolor);
            PangoCairo.layout_path(cr, pl);
            cr.stroke();
        }
    }
}
