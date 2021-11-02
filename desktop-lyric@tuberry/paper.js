// vim:fdm=syntax
// by tuberry
/* exported Paper */
'use strict';

const Cairo = imports.cairo;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { Gio, Clutter, Meta, PangoCairo, Pango, St, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const gsettings = ExtensionUtils.getSettings();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;

const splitAt = i => x => [x.slice(0, i), x.slice(i)];
const toMS = x => x.split(':').reverse().reduce((a, v, i) => a + parseFloat(v) * 60 ** i, 0) * 1000; // 1:1 => 61000 ms

const DragMove = class extends DND._Draggable {
    _dragActorDropped(event) {
        // override this for moving only and do nothing more
        this._dragCancellable = false;
        this._dragState = DND.DragState.INIT;
        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this.emit('drag-end', event.get_time(), true);
        this._dragComplete();

        return true;
    }
};

var Paper = GObject.registerClass({
    Properties: {
        'drag':     GObject.ParamSpec.boolean('drag', 'drag', 'drag', GObject.ParamFlags.READWRITE, false),
        'hide':     GObject.ParamSpec.boolean('hide', 'hide', 'hide', GObject.ParamFlags.READWRITE, false),
        'font':     GObject.ParamSpec.string('font', 'font', 'font', GObject.ParamFlags.READWRITE, 'Sans 40'),
        'orient':   GObject.ParamSpec.uint('orient', 'orient', 'orient', GObject.ParamFlags.READWRITE, 0, 1, 0),
        'xpos':     GObject.ParamSpec.int('xpos', 'xpos', 'xpos', GObject.ParamFlags.READWRITE, -100, 65535, 10),
        'ypos':     GObject.ParamSpec.int('ypos', 'ypos', 'ypos', GObject.ParamFlags.READWRITE, -100, 65535, 10),
        'offset':   GObject.ParamSpec.int('offset', 'offset', 'offset', GObject.ParamFlags.READWRITE, -100000, 100000, 0),
        'outline':  GObject.ParamSpec.string('outline', 'outline', 'outline', GObject.ParamFlags.READWRITE, 'rgba(0, 0, 0, 0.2)'),
        'active':   GObject.ParamSpec.string('active', 'active', 'active', GObject.ParamFlags.READWRITE, 'rgba(100, 50, 150, 0.5)'),
        'inactive': GObject.ParamSpec.string('inactive', 'inactive', 'inactive', GObject.ParamFlags.READWRITE, 'rgba(230, 230, 230, 0.5)'),
        'position': GObject.ParamSpec.int64('position', 'position', 'position', GObject.ParamFlags.READWRITE, 0, Number.MAX_SAFE_INTEGER, 0),
    },
}, class Paper extends GObject.Object {
    _init() {
        super._init();

        this.length = 0;
        this.text = '';
        this._area = new St.DrawingArea({ reactive: false });
        this.bind_property('hide', this._area, 'visible', GObject.BindingFlags.INVERT_BOOLEAN);
        Main.uiGroup.add_actor(this._area);

        this._bindSettings();
        this._area.set_position(this.xpos, this.ypos);
        this._area.connect('repaint', this._repaint.bind(this));
    }

    _bindSettings() {
        gsettings.bind(Fields.FONT,     this, 'font',     Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.DRAG,     this, 'drag',     Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ACTIVE,   this, 'active',   Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.OUTLINE,  this, 'outline',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.INACTIVE, this, 'inactive', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.HIDE,     this, 'hide',     Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.XPOS,     this, 'xpos',     Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.YPOS,     this, 'ypos',     Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ORIENT,   this, 'orient',   Gio.SettingsBindFlags.GET);
    }

    getColor(color, fallbk) {
        let [ok, cl] = Clutter.Color.from_string(color);
        return ok ? [cl.red / 255, cl.green / 255, cl.blue / 255, cl.alpha / 255] : fallbk;
    }

    set active(active) {
        this._active = this.getColor(active, [0.4, 0.2, 0.6, 0.5]);
    }

    set outline(outline) {
        this._outline = this.getColor(outline, [0, 0, 0, 0.2]);
    }

    set inactive(inactive) {
        this._inactive = this.getColor(inactive, [0.9, 0.9, 0.9, 0.5]);
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
    }

    set drag(drag) {
        if(drag) {
            if(this._drag) return;
            this._area.reactive = true;
            this._drag = new DragMove(this._area, { dragActorOpacity: 200 });
            this._drag.connect('drag-end', () => {
                gsettings.set_boolean(Fields.DRAG, false);
                [this.xpos, this.ypos] = this._area.get_position();
            });
        } else {
            if(!this._drag) return;
            delete this._drag;
            this._area.reactive = false;
        }
    }

    set position(position) {
        this._position = position;
        if(this._area.visible) this._area.queue_repaint();
    }

    set orient(orient) {
        this._orient = orient;
        let [w, h] = global.display.get_size();
        orient ? this._area.set_size(0.18 * w, h) : this._area.set_size(w, 0.3 * h);
    }

    _repaint(area) {
        let cr = area.get_context();
        let [w, h] = area.get_surface_size();
        this.draw(cr, w, h);

        cr.$dispose();
    }

    set text(text) {
        this._text = text.split(/\n/)
            .flatMap(x => (i => i > 0 ? [splitAt(i + 1)(x)] : [])(x.lastIndexOf(']')))
            .flatMap(x => x[0].match(/(?<=\[)[^\][]+(?=])/g).map(y => [Math.round(toMS(y)), x[1]]))
            .sort((u, v) => u[0] > v[0])
            .reduce((a, v, i, arr) => a.set([v[0]], [v[0], arr[i + 1] ? arr[i + 1][0] : Math.max(this.length, v[0]), v[1]]), new Map());
        this._tags = Array.from(this._text.keys()).reverse();
        this.offset = 0;
    }

    slower() {
        this.offset -= 500;
    }

    faster() {
        this.offset += 500;
    }

    clear() {
        this.text = '';
        this._area.queue_repaint();
    }

    get text() {
        let now = this._position + this.offset;
        let key = this._tags.find(k => parseFloat(k) <= now);
        if(key === undefined) return [0, ''];
        let [s, e, t] = this._text.get(key);
        return [now >= e || s === e ? 1 : (now - s) / (e - s), t];
    }

    draw(cr, w, _h) {
        let [position, txt] = this.text;
        if(!txt) return;
        cr.save();
        let ly = PangoCairo.create_layout(cr);
        ly.set_font_description(this._font);
        ly.set_text(txt, -1);
        let [fw, fh] = ly.get_pixel_size();
        let gd = this._orient ? new Cairo.LinearGradient(0, 0, 0, fw) : new Cairo.LinearGradient(0, 0, fw, 0);
        gd.addColorStopRGBA(0, ...this._active);
        gd.addColorStopRGBA(position, ...this._active);
        gd.addColorStopRGBA(position, ...this._inactive);
        gd.addColorStopRGBA(1, ...this._inactive);
        cr.moveTo((a => a > 0 ? 0 : a)(w - position * fw), 0);
        cr.setSource(gd);
        if(this._orient) {
            ly.get_context().set_base_gravity(Pango.Gravity.EAST);
            cr.moveTo(fh, 0);
            cr.rotate(Math.PI / 2);
        }
        PangoCairo.show_layout(cr, ly);
        cr.setSourceRGBA(...this._outline);
        PangoCairo.layout_path(cr, ly);
        cr.stroke();
        cr.restore();
    }

    destroy() {
        this.drag = false;
        this._area.destroy();
        delete this._area;
    }
});

