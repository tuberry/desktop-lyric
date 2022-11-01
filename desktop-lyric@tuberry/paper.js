// vim:fdm=syntax
// by tuberry
/* exported DesktopPaper PanelPaper */
'use strict';

const Cairo = imports.cairo;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { Gio, Clutter, Meta, PangoCairo, Pango, St, GObject } = imports.gi;
const { Fields } = imports.misc.extensionUtils.getCurrentExtension().imports.fields;

const splitAt = i => x => [x.slice(0, i), x.slice(i)];
const toMS = x => x.split(':').reverse().reduce((a, v, i) => a + parseFloat(v) * 60 ** i, 0) * 1000; // 1:1 => 61000 ms

class Field {
    constructor(prop, gset, obj) {
        this.gset = typeof gset === 'string' ? new Gio.Settings({ schema: gset }) : gset;
        this.prop = prop;
        this.attach(obj);
    }

    _get(x) {
        return this.gset[`get_${this.prop[x][1]}`](this.prop[x][0]);
    }

    _set(x, y) {
        this.gset[`set_${this.prop[x][1]}`](this.prop[x][0], y);
    }

    attach(a) {
        let fs = Object.entries(this.prop);
        fs.forEach(([x]) => { a[x] = this._get(x); });
        this.gset.connectObject(...fs.flatMap(([x, [y]]) => [`changed::${y}`, () => { a[x] = this._get(x); }]), a);
    }

    detach(a) {
        this.gset.disconnectObject(a);
    }
}

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

var BasePaper = class extends St.DrawingArea {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super({ reactive: false });
        this.span = 0;
        this.text = '';
        this._bindSettings(gset);
    }

    _bindSettings(gset) {
        this._field = new Field({
            active:   [Fields.ACTIVE,   'string'],
            inactive: [Fields.INACTIVE, 'string'],
        }, gset, this);
    }

    genColor(color) {
        return Clutter.Color.from_string(color).reduce((a, x) => a && x);
    }

    normColor({ red, green, blue, alpha }) {
        return [red, green, blue, alpha].map(x => x / 255);
    }

    set active(active) {
        this._acolor = this.genColor(active) || Clutter.Color.from_string('#643296')[1];
        this._active = this.normColor(this._acolor);
    }

    set inactive(inactive) {
        this._icolor = this.genColor(inactive) || Clutter.Color.from_string('#f5f5f5')[1];
        this._inactive = this.normColor(this._icolor);
    }

    set moment(moment) {
        this._moment = moment;
        let txt = this._txt;
        [this._pos, this._txt] = this.text;
        if(!this.visible || this._icolor.equal(this._acolor) && this._txt === txt) return;
        this.queue_repaint();
    }

    vfunc_repaint() {
        let cr = this.get_context();
        let [w, h] = this.get_surface_size();
        let pl = PangoCairo.create_layout(cr);
        this._setup_layout(cr, h, pl);
        this._color_layout(cr, w, pl);
        this._show_layout(cr, pl);
        cr.$dispose();
    }

    set text(text) {
        this._text = text.split(/\n/)
            .flatMap(x => (i => i > 0 ? [splitAt(i + 1)(x)] : [])(x.lastIndexOf(']')))
            .flatMap(x => x[0].match(/(?<=\[)[^\][]+(?=])/g).map(y => [Math.round(toMS(y)), x[1]]))
            .sort(([u], [v]) => u - v)
            .reduce((ac, v, i, a) => ac.set(v[0], [a[i + 1] ? a[i + 1][0] : Math.max(this.span, v[0]), v[1]]), new Map());
        this._tags = Array.from(this._text.keys()).reverse();
    }

    get text() {
        let now = this._moment;
        let key = this._tags.find(x => x <= now);
        if(key === undefined) return [0, ''];
        let [end, txt] = this._text.get(key);
        return [now >= end || key === end ? 1 : (now - key) / (end - key), txt];
    }

    _setup_layout(cr, h, pl) {
        pl.set_font_description(this._font);
        pl.set_text(this._txt ?? '', -1);
    }

    _color_layout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        let gd = this._orient ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
        [[0, this._active], [this._pos, this._active], [this._pos, this._inactive],
            [1, this._inactive]].forEach(([x, y]) => gd.addColorStopRGBA(x, ...y));
        cr.moveTo(Math.min(w - this._pos * pw, 0), 0);
        cr.setSource(gd);
    }

    _show_layout(cr, pl) {
        PangoCairo.show_layout(cr, pl);
    }

    destroy() {
        this._field.detach(this);
        super.destroy();
    }
};

var PanelPaper = class extends BasePaper {
    static {
        GObject.registerClass(this);
    }

    _bindSettings(gset) {
        super._bindSettings(gset);
        this._ffield = new Field({
            font: ['font-name', 'string'],
        }, 'org.gnome.desktop.interface', this);
        let [w, h] = Main.panel.get_size();
        this._pixel_width = this._max_width = w / 4;
        this.set_size(this._max_width, h);
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
        this._font.set_weight(Pango.Weight.BOLD);
    }

    get_fgcolor() {
        let bg = Main.panel.get_background_color();
        bg.alpha = 255;
        return Clutter.Color.from_string('#fff')[1].subtract(bg);
    }

    set active(active) {
        this._acolor = this.genColor(active) || Clutter.Color.from_string('#643296')[1];
        this._active = this.normColor(this._acolor.interpolate(this.get_fgcolor(), 0.65));
    }

    set inactive(inactive) {
        this._icolor = this.genColor(inactive) || Clutter.Color.from_string('#f5f5f5')[1];
        this._inactive = this._acolor?.equal(this._icolor) ? this._active : this.normColor(this.get_fgcolor());
    }

    set moment(moment) {
        super.moment = moment;
        this.set_width(Math.min(this._max_width, this._pixel_width + 4));
    }

    _setup_layout(cr, h, pl) {
        super._setup_layout(cr, h, pl);
        let [pw, ph] = pl.get_pixel_size();
        this._pixel_width = pw;
        cr.translate(0, (h - ph) / 2);
    }

    destroy() {
        this._ffield.detach(this);
        super.destroy();
    }
};

var DesktopPaper = class extends BasePaper {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super(gset);
        Main.uiGroup.add_actor(this);
        this.set_position(this.xpos, this.ypos);
    }

    _bindSettings(gset) {
        this._field = new Field({
            drag:     [Fields.DRAG,     'boolean'],
            orient:   [Fields.ORIENT,   'uint'],
            font:     [Fields.FONT,     'string'],
            xpos:     [Fields.XPOS,     'uint'],
            ypos:     [Fields.YPOS,     'uint'],
            outline:  [Fields.OUTLINE,  'string'],
            active:   [Fields.ACTIVE,   'string'],
            inactive: [Fields.INACTIVE, 'string'],
        }, gset, this);
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
    }

    set outline(outline) {
        this._ocolor = this.genColor(outline) || Clutter.Color.from_string('#000')[1];
        this._outline = this.normColor(this._ocolor);
        this._draw_outline = this._outline[3] > 0;
    }

    set drag(drag) {
        if(drag) {
            if(this._drag) return;
            Main.layoutManager.trackChrome(this);
            this.reactive = true;
            this._drag = new DragMove(this, { dragActorOpacity: 200 });
            this._drag.connect('drag-end', () => {
                Main.layoutManager.untrackChrome(this);
                let [x, y] = this.get_position();
                this._field._set('drag', false);
                this._field._set('xpos', x);
                this._field._set('ypos', y);
            });
        } else {
            if(!this._drag) return;
            this._drag = null;
            this.reactive = false;
        }
    }

    set orient(orient) {
        this._orient = orient;
        let [w, h] = global.display.get_size();
        orient ? this.set_size(0.18 * w, h) : this.set_size(w, 0.3 * h);
    }

    _show_layout(cr, pl) {
        if(this._orient) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size()[1], 0);
            cr.rotate(Math.PI / 2);
        }
        PangoCairo.show_layout(cr, pl);
        if(this._draw_outline) {
            cr.setSourceRGBA(...this._outline);
            PangoCairo.layout_path(cr, pl);
            cr.stroke();
        }
    }
};
