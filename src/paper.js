// vim:fdm=syntax
// by tuberry
/* exported DesktopPaper PanelPaper */
'use strict';

const Cairo = imports.cairo;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { Clutter, Meta, PangoCairo, Pango, St, GObject, GLib } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { Symbiont } = Me.imports.fubar;
const { Field } = Me.imports.const;
const { xnor } = Me.imports.util;

const t2ms = x => x?.split(':').reverse().reduce((p, v, i) => p + parseFloat(v) * 60 ** i, 0) * 1000; // 1:1 => 61000 ms
const c2gdk = ({ red, green, blue, alpha }, tp) => [red, green, blue, tp ?? alpha].map(x => x / 255);

class DragMove extends DND._Draggable {
    _dragActorDropped(event) {
        // override for moving only
        this._dragCancellable = false;
        this._dragState = DND.DragState.INIT;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this.emit('drag-end', event.get_time(), true);
        this._dragComplete();
        return true;
    }
}

class BasePaper extends St.DrawingArea {
    static {
        GObject.registerClass(this);
    }

    constructor(fulu) {
        super({ reactive: false });
        this._text = new Map();
        this.span = 0;
        this.text = '';
        this._bindSettings(fulu);
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            acolor: [Field.ACTIVE,   'string', '#643296'],
            icolor: [Field.INACTIVE, 'string', '#f5f5f5'],
        }, this, 'color');
    }

    set color([k, v, out]) {
        this[k] = Clutter.Color.from_string(v).reduce((p, x) => p && x) || Clutter.Color.from_string(out).at(1);
        if('acolor' in this && 'icolor' in this) this._homochromy = this.acolor.equal(this.icolor);
        this[`_${k}`] = c2gdk(this[k]);
    }

    set moment(moment) {
        this._moment = moment;
        let lrc = this._lrc;
        [this._pos, this._lrc] = this.getLyric();
        if(!this.visible || this._homochromy && this._lrc === lrc) return;
        this.queue_repaint();
    }

    set text(text) {
        this._text.clear();
        text.split(/\n/)
            .flatMap(x => (i => i > 0 ? [[x.slice(0, i), x.slice(i)]] : [])(x.lastIndexOf(']') + 1))
            .flatMap(x => x[0].match(/(?<=\[)[^\][]+(?=])/g).map(y => [Math.round(t2ms(y)), x[1].trim()]))
            .sort(([x], [y]) => x - y)
            .forEach((v, i, a) => this._text.set(v[0], [a[i + 1] ? a[i + 1][0] : Math.max(this.span, v[0]), v[1]]));
        this._tags = Array.from(this._text.keys()).reverse();
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

    clear() {
        this.text = '';
        [this._pos, this._lrc] = this.getLyric();
        this.queue_repaint();
    }

    getLyric() {
        let now = this._moment;
        let key = this._tags.find(x => x <= now);
        if(key === undefined) return [0, ''];
        let [end, lrc] = this._text.get(key);
        return [now >= end || key === end ? 1 : (now - key) / (end - key), lrc];
    }

    _setupLayout(_cr, _h, pl) {
        pl.set_font_description(this._font);
        pl.set_text(this._lrc ?? '', -1);
    }

    _colorLayout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        let gd = this._orient ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
        [[0, this._acolor], [this._pos, this._acolor], [this._pos, this._icolor],
            [1, this._icolor]].forEach(([x, y]) => gd.addColorStopRGBA(x, ...y));
        cr.moveTo(Math.min(w - this._pos * pw, 0), 0);
        cr.setSource(gd);
    }

    _showLayout(cr, pl) {
        PangoCairo.show_layout(cr, pl);
    }
}

var PanelPaper = class extends BasePaper {
    static {
        GObject.registerClass(this);
    }

    _bindSettings(fulu) {
        this._natural_width = 0;
        super._bindSettings(fulu);
        St.ThemeContext.get_for_stage(global.stage).connectObject('changed', () => this._syncPanelTheme(), this);
        new Symbiont(() => St.ThemeContext.get_for_stage(global.stage).disconnectObject(this), this);
    }

    _syncPanelTheme() {
        if(!('acolor' in this && 'icolor' in this)) return;
        let fg = Main.panel.get_theme_node().lookup_color('color', true).at(1);
        this._acolor = c2gdk(this.acolor.interpolate(fg, 0.65), fg.alpha);
        this._icolor = this._homochromy ? this._acolor : c2gdk(fg);
        this._font = Main.panel.get_theme_node().get_font();
        let [w, h] = Main.panel.get_size();
        this._max_width = w / 4;
        this.set_height(h);
    }

    set color([k, v, out]) {
        super.color = [k, v, out];
        this._syncPanelTheme();
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
};

var DesktopPaper = class extends BasePaper {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super(gset);
        Main.uiGroup.add_actor(this);
        this.set_position(...this.place.deepUnpack());
    }

    _bindSettings(fulu) {
        super._bindSettings(fulu);
        this._fulu.attach({
            drag:   [Field.DRAG,    'boolean'],
            orient: [Field.ORIENT,  'uint'],
            font:   [Field.FONT,    'string'],
            place:  [Field.PLACE,   'value'],
        }, this).attach({
            ocolor: [Field.OUTLINE, 'string'],
        }, this, 'color');
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
    }

    set drag(drag) {
        if(xnor(drag, this._drag)) return;
        if(drag) {
            Main.layoutManager.trackChrome(this);
            this.reactive = true;
            this._drag = new DragMove(this, { dragActorOpacity: 200 });
            this._drag.connect('drag-end', () => {
                Main.layoutManager.untrackChrome(this);
                this.setf('drag', false);
                this.setf('place', new GLib.Variant('(uu)', this.get_position()));
            });
        } else {
            this._drag = null;
            this.reactive = false;
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
};
