// vim:fdm=syntax
// by tuberry
/* exported DesktopPaper PanelPaper */
'use strict';

const Cairo = imports.cairo;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { Clutter, Meta, PangoCairo, Pango, St, GObject, GLib } = imports.gi;
const { Fields, Field } = imports.misc.extensionUtils.getCurrentExtension().imports.fields;

const t2ms = x => x?.split(':').reverse().reduce((p, v, i) => p + parseFloat(v) * 60 ** i, 0) * 1000; // 1:1 => 61000 ms
const c2gdk = ({ red, green, blue, alpha }) => [red, green, blue, alpha].map(x => x / 255);

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

    constructor(field) {
        super({ reactive: false });
        this._text = new Map();
        this.span = 0;
        this.text = '';
        this._bindSettings(field);
    }

    _bindSettings(field) {
        this._field = field.attach({
            acolor: [Fields.ACTIVE,   'string', '#643296'],
            icolor: [Fields.INACTIVE, 'string', '#f5f5f5'],
        }, this, 'color');
    }

    set color([k, v, out]) {
        this[k] = Clutter.Color.from_string(v).reduce((p, x) => p && x) || Clutter.Color.from_string(out)[1];
        this[`_${k}`] = c2gdk(this[k]);
    }

    set moment(moment) {
        this._moment = moment;
        let lrc = this._lrc;
        [this._pos, this._lrc] = this.getLyric();
        if(!this.visible || this.icolor.equal(this.acolor) && this._lrc === lrc) return;
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

    destroy() {
        this._field.detach(this);
        super.destroy();
    }
};

var PanelPaper = class extends BasePaper {
    static {
        GObject.registerClass(this);
    }

    _bindSettings(field) {
        super._bindSettings(field);
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

    getFgcolor() {
        let bg = Main.panel.get_background_color();
        bg.alpha = 255;
        return Clutter.Color.from_string('#fff')[1].subtract(bg);
    }

    set color([k, v, out]) {
        super.color = [k, v, out];
        if(k === 'acolor') this._acolor = c2gdk(this.acolor.interpolate(this.getFgcolor(), 0.65));
        if('acolor' in this && 'icolor' in this) this._icolor = this.acolor.equal(this.icolor) ? this._acolor : c2gdk(this.getFgcolor());
    }

    set moment(moment) {
        super.moment = moment;
        this.set_width(Math.min(this._max_width, this._pixel_width + 4));
    }

    _setupLayout(cr, h, pl) {
        super._setupLayout(cr, h, pl);
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
        this.set_position(...this.place.deepUnpack());
    }

    _bindSettings(field) {
        super._bindSettings(field);
        this._field.attach({
            drag:   [Fields.DRAG,    'boolean'],
            orient: [Fields.ORIENT,  'uint'],
            font:   [Fields.FONT,    'string'],
            place:  [Fields.PLACE,   'value'],
        }, this).attach({
            ocolor: [Fields.OUTLINE, 'string'],
        }, this, 'color');
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
    }

    set drag(drag) {
        if(drag) {
            if(this._drag) return;
            Main.layoutManager.trackChrome(this);
            this.reactive = true;
            this._drag = new DragMove(this, { dragActorOpacity: 200 });
            this._drag.connect('drag-end', () => {
                Main.layoutManager.untrackChrome(this);
                this.setf('drag', false);
                this.setf('place', new GLib.Variant('(uu)', this.get_position()));
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

    _showLayout(cr, pl) {
        if(this._orient) {
            pl.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(pl.get_pixel_size()[1], 0);
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
