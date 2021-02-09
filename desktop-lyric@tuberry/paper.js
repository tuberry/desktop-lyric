const Cairo = imports.cairo;
const DND = imports.ui.dnd;
const Main = imports.ui.main;
const { Gio, Clutter, Meta, PangoCairo, Pango, St, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const gsettings = ExtensionUtils.getSettings();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.prefs.Fields;

var DragMove = class extends DND._Draggable {
    _dragActorDropped(event) {
        // override this for moving only and do nothing more
        this._dragCancellable = false;
        this._dragState = DND.DragState.INIT;

        global.display.set_cursor(Meta.Cursor.DEFAULT);
        this.emit('drag-end', event.get_time(), true);
        this._dragComplete();
        return true;
    }
}

var Paper = GObject.registerClass({
    Properties: {
        'drag':     GObject.param_spec_boolean('drag', 'drag', 'drag', false, GObject.ParamFlags.READWRITE),
        'font':     GObject.param_spec_string('font', 'font', 'font', 'Sans 40', GObject.ParamFlags.READWRITE),
        'xpos':     GObject.param_spec_int('xpos', 'xpos', 'xpos', -100, 65535, 10, GObject.ParamFlags.READWRITE),
        'ypos':     GObject.param_spec_int('ypos', 'ypos', 'ypos', -100, 65535, 10, GObject.ParamFlags.READWRITE),
        'offset':   GObject.param_spec_int('offset', 'offset', 'offset', -100000, 100000, 0, GObject.ParamFlags.READWRITE),
        'active':   GObject.param_spec_string('active', 'active', 'active', 'rgba(100, 50, 150, 0.5)', GObject.ParamFlags.READWRITE),
        'outline':  GObject.param_spec_string('outline', 'outline', 'outline', 'rgba(0, 0, 0, 0.2)', GObject.ParamFlags.READWRITE),
        'inactive': GObject.param_spec_string('inactive', 'inactive', 'inactive', 'rgba(230, 230, 230, 0.5)', GObject.ParamFlags.READWRITE),
        'position': GObject.param_spec_int64('position', 'position', 'position', 0, Number.MAX_SAFE_INTEGER, 0, GObject.ParamFlags.READWRITE),
    },
}, class Paper extends GObject.Object {
    _init() {
        super._init();

        this.text = '';
        let [w, h] = global.display.get_size();
        this._area = new St.DrawingArea({ reactive: false });
        this._area.set_size(w, 0.3 * h);
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
        gsettings.bind(Fields.XPOS,     this, 'xpos',     Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.YPOS,     this, 'ypos',     Gio.SettingsBindFlags.DEFAULT);
    }

    set active(active) {
        let [ok, color] = Clutter.Color.from_string(active);
        if(ok) {
            this._active = [color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255]
        } else {
            this._active = [0.4, 0.2, 0.6, 0.5];
        }
    }

    set outline(outline) {
        let [ok, color] = Clutter.Color.from_string(outline);
        if(ok) {
            this._outline = [color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255]
        } else {
            this._outline = [0, 0, 0, 0.2];
        }
    }

    set inactive(inactive) {
        let [ok, color] = Clutter.Color.from_string(inactive);
        if(ok) {
            this._inactive = [color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255]
        } else {
            this._inactive = [0.9, 0.9, 0.9, 0.5];
        }
    }

    set font(font) {
        this._font = Pango.FontDescription.from_string(font);
    }

    set drag(drag) {
        if(drag) {
            if(this._drag) return;
            this._area.reactive = true;
            this._drag = new DragMove(this._area, { dragActorOpacity : 200, });
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
        this._area.queue_repaint();
    }

    _repaint(area) {
        let cr = area.get_context();
        let [x, y] = area.get_surface_size();
        this.draw(cr, x, y);

        cr.$dispose();
    }

    set text(text) {
        let ms = x => x.split(':').reverse().reduce((acc, v, i) => (acc + parseFloat(v) * 60 ** i), 0) * 1000; // 1:1 => 61000 ms
        this._text = text.split(/\[/)
            .filter(x => x)
            .map(x => x.split(/\]/))
            .map(x => [Math.round(ms(x[0])), x[1]])
            .reduce((acc, v, i, a) => {
                acc[v[0]] = [v[0], a[i + 1] ? a[i + 1][0] : v[0], v[1]];
                return acc;
            }, {});
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
        let key = Object.keys(this._text).reverse().find(k => parseFloat(k) <= now);
        if(key == undefined) return [0, ''];
        let [s, e, t] = this._text[key];
        return [now >= e || s == e ? 1 : (now - s) / (e - s), t];
    }

    draw(cr, x, y) {
        let [position, txt] = this.text;
        if(!txt) return;
        cr.save();
        let ly = PangoCairo.create_layout(cr);
        ly.set_font_description(this._font);
        ly.set_text(txt, -1);
        let [fw, fh] = ly.get_pixel_size();
        let gd = new Cairo.LinearGradient(0, 0, fw, 0);
        gd.addColorStopRGBA(0, ...this._active);
        gd.addColorStopRGBA(position, ...this._active);
        gd.addColorStopRGBA(position, ...this._inactive);
        gd.addColorStopRGBA(1, ...this._inactive);
        cr.moveTo(0, 0);
        cr.setSource(gd);
        PangoCairo.show_layout(cr, ly);
        cr.setSourceRGBA(...this._outline);
        PangoCairo.layout_path(cr, ly);
        cr.stroke()
        cr.restore();
    }

    destroy() {
        this.drag = false;
        this._area.destroy();
        delete this._area;
    }
});

