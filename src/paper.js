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
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const {$, $$} = T;

const time2ms = time => Math.round(time.split(':').reduce((p, x) => parseFloat(x) + p * 60, 0) * 1000); // '1:1' => 61000 ms
const color2rgba = ({red, green, blue, alpha = 255}, opacity) => [red, green, blue].map(x => x / 255)[$].push(opacity ?? alpha / 255);

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
        super(param)[$]
            .$clearLyric()[$]
            .$bindSettings(set)[$]
            .$buildWidgets();
    }

    $bindSettings(set) {
        this.$set = set.tie([[K.PRGR, x => !x]], this, () => { this.$lrc = `\u{200b}${this.$lrc}`; this.queue_repaint(); }); // NOTE: force redrawing
    }

    $buildWidgets() {
        F.connect(this, F.theme(), 'changed', (() => this.$onColorChange())[$].call());
    }

    get hasValidContent() {
        return this.$lrc && this.$lrc.trim() !== '' && this.$lrc !== '\u{200b}';
    }

    vfunc_repaint() {
        // Skip drawing if no content to display
        if (!this.hasValidContent) return;
        
        let cr = this.get_context(),
            [w, h] = this.get_surface_size(),
            pl = PangoCairo.create_layout(cr);
        this.$setupLayout(cr, h, pl);
        this.$colorLayout(cr, w, pl);
        this.$showLayout(cr, pl);

        cr.$dispose();
    }

    $clearLyric() {
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
        this.$clearLyric();
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
        if (!this.hasValidContent) return;
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
        this.$tags = this.$lrcs.keys().toArray();
        this.queue_repaint();
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

    $bindSettings(set) {
        this.$maxWidth = 0; // Initialize before binding to avoid race condition
        super.$bindSettings(set);
        this.$set.tie([
            [K.PWID, x => this.$updatePanelWidth(x)],
        ], this);
    }

    $buildWidgets() {
        F.connect(this, Main.panel.statusArea.quickSettings, 'style-changed', (() => this.$onStyleChange())[$].call());
        this.$naturalWidth = 0;
        this.$scrollOffset = 0; // Current scroll offset for title
        this.$scrollTimer = null; // Timer for title scrolling
        this.$scrollDelay = 0; // Delay counter before starting scroll
        super.$buildWidgets();
    }

    $updatePanelWidth(width) {
        this.$maxWidth = width;
        this.set_width(width);
        this.queue_repaint();
    }

    $onStyleChange() {
        let theme = Main.panel.statusArea.quickSettings.get_theme_node();
        let [_w, h] = Main.panel.get_size();
        this[$].$font(theme.get_font())[$]
            .inactiveColor(color2rgba(theme.get_foreground_color()))[$]
            .$maxWidth(this[K.PWID])[$]
            .set_height(h)[$]
            .$onColorChange();
    }

    get homochromyColor() { return this.inactiveColor; }

    $onColorChange() {
        this.activeColor = color2rgba(F.theme().get_accent_color()[0]).map((x, i) => Util.lerp(x, this.inactiveColor[i], 0.2));
    }

    setMoment(moment) {
        this.moment = moment;
        let {$pos, $lrc: $txt} = this;
        [this.$pos, this.$lrc] = this.getLyric();
        
        // Skip if invisible or no changes
        if(!this.visible || (this.$pos === $pos && this.$lrc === $txt)) return;
        
        // Skip drawing if no content
        if (!this.hasValidContent) {
            this.#stopTitleScrolling();
            return;
        }
        
        // Manage title scrolling: only scroll when displaying title (no lyrics)
        let isDisplayingTitle = (this.$len === 0 || this.$lrc === this.song);
        if (isDisplayingTitle) {
            this.#startTitleScrolling();
        } else {
            this.#stopTitleScrolling();
        }
        
        this.queue_repaint();
        
        // Always use fixed max width to prevent pushing other panel components
        this.set_width(this.$maxWidth);
    }

    $setupLayout(cr, h, pl) {
        super.$setupLayout(cr, h, pl);
        let [pw, ph] = pl.get_pixel_size();
        this.$naturalWidth = pw;
        
        // Set up clipping BEFORE translate to ensure correct coordinate system
        cr.save();
        cr.rectangle(0, 0, this.$maxWidth, h);
        cr.clip();
        
        // Now do vertical centering
        let yOffset = (h - ph) / 2;
        cr.translate(0, yOffset);
    }

    #startTitleScrolling() {
        // Start title scrolling if title is too long
        if (this.$scrollTimer || !this.hasValidContent) return;
        
        // Reset scroll state
        this.$scrollOffset = 0;
        this.$scrollDelay = 0;
        
        // Will check if scrolling is needed on next repaint
        this.$scrollTimer = setInterval(() => {
            if (this.$naturalWidth > this.$maxWidth) {
                const DELAY_FRAMES = 40; // Wait 2 seconds before scrolling (40 * 50ms)
                const scrollSpeed = 1; // pixels per frame
                const gap = 40; // Gap between end and start of looping title
                
                // Wait for delay period before starting scroll
                if (this.$scrollDelay < DELAY_FRAMES) {
                    this.$scrollDelay++;
                    return;
                }
                
                // Title is too long, scroll it
                this.$scrollOffset += scrollSpeed;
                
                // Loop the scrolling: reset when scrolled past one complete cycle
                // One cycle = when the second title reaches where the first started
                if (this.$scrollOffset >= this.$naturalWidth + gap) {
                    this.$scrollOffset = 0;
                    this.$scrollDelay = 0; // Reset delay for next cycle
                }
                
                this.queue_repaint();
            }
        }, 50); // 20 FPS
    }

    #stopTitleScrolling() {
        if (this.$scrollTimer) {
            clearInterval(this.$scrollTimer);
            this.$scrollTimer = null;
            this.$scrollOffset = 0;
            this.$scrollDelay = 0;
        }
    }

    $colorLayout(cr, w, pl) {
        let [pw] = pl.get_pixel_size();
        let offset = 0;
        let skipMoveTo = false;
        
        // Check if displaying title (no lyrics)
        let isDisplayingTitle = (this.$len === 0 || this.$lrc === this.song);
        
        if (isDisplayingTitle && pw > w) {
            // Title scrolling: apply scroll offset
            // Translate the canvas to create scrolling effect
            cr.translate(-this.$scrollOffset, 0);
            skipMoveTo = true; // Don't set moveTo, already translated
        } else if (pw > w) {
            // Lyrics wider than panel: scroll to keep progress bar centered
            let progressPixel = this.$pos * pw; // Current progress position in pixels
            let centerPoint = w / 2; // Center of the panel
            
            // Calculate offset using center formula
            let centeredOffset = centerPoint - progressPixel;
            
            // Stage 1→2 transition: when centeredOffset = 0 (progress bar reaches center naturally)
            // This happens when progressPixel = w/2
            let stage1End = w / 2;
            
            // Stage 2→3 transition: when centeredOffset = w - pw (would scroll past end)
            // This happens when progressPixel = pw - w/2
            let stage2End = pw - w / 2;
            
            if (progressPixel <= stage1End) {
                // Stage 1: Progress bar moving to center, no scroll
                offset = 0;
            } else if (progressPixel >= stage2End) {
                // Stage 3: Show end of lyrics, progress bar moves from center to right
                offset = w - pw;
            } else {
                // Stage 2: Keep progress bar centered, scroll lyrics
                offset = centeredOffset;
            }
        }
        
        if (!skipMoveTo) {
            cr.moveTo(offset, 0);
        }
        
        if(this[K.PRGR]) {
            cr.setSourceRGBA(...this.homochromyColor);
        } else {
            let gd;
            
            if (offset !== 0) {
                // Stage 2 or 3: Adjust gradient to follow lyrics offset
                gd = this[K.ORNT] ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(offset, 0, pw + offset, 0);
            } else {
                // Stage 1: No offset, use normal gradient
                gd = this[K.ORNT] ? new Cairo.LinearGradient(0, 0, 0, pw) : new Cairo.LinearGradient(0, 0, pw, 0);
            }
            
            gd.addColorStopRGBA(0, ...this.activeColor);
            gd.addColorStopRGBA(this.$pos, ...this.activeColor);
            gd.addColorStopRGBA(this.$pos, ...this.inactiveColor);
            gd.addColorStopRGBA(1, ...this.inactiveColor);
            cr.setSource(gd);
        }
    }

    $showLayout(cr, pl) {
        // Check if displaying title and scrolling
        let isDisplayingTitle = (this.$len === 0 || this.$lrc === this.song);
        let [pw] = pl.get_pixel_size();
        
        if (isDisplayingTitle && pw > this.$maxWidth) {
            // Draw the scrolling title with seamless loop
            const gap = 40; // Gap between end and start
            
            // Draw first instance of title at (0, 0)
            // Color was already set in $colorLayout
            PangoCairo.show_layout(cr, pl);
            
            // Draw second instance for seamless loop
            // Translate to the right of first title
            // NOTE: Don't use save/restore here as it resets the source color
            cr.translate(pw + gap, 0);
            PangoCairo.show_layout(cr, pl);
            cr.translate(-(pw + gap), 0); // Restore position manually
        } else {
            // Normal drawing
            super.$showLayout(cr, pl);
        }
        
        // Restore the context (matching the save in $setupLayout)
        cr.restore();
    }
}

export class Desktop extends PaperBase {
    static {
        T.enrol(this);
    }

    constructor(drag, ...args) {
        super(...args).setDrag(drag);
    }

    $buildWidgets() {
        super.$buildWidgets();
        Main.uiGroup.add_child(this);
        F.connect(this, F.theme(), 'notify::scale-factor', (() => this.$onFontSet())[$].call());
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
            [K.SITE, x => T.seq(x, y => this.set_position(...y)), null, true],
        ], this).tie([K.FONT], this, null, () => this.$onFontSet());
    }

    get homochromyColor() { return this.activeColor; }

    $onFontSet() {
        this.$font = Pango.FontDescription.from_string(this[K.FONT] ?? 'Sans 11');
        this.$font.set_size(this.$font.get_size() * F.theme().scaleFactor * (this.scaling ?? 1));
    }

    $genDraggable() {
        let ret = DND.makeDraggable(this, {dragActorOpacity: 200});
        ret._dragActorDropped = () => {
            ret._dragComplete();
            global.display.set_cursor(Meta.Cursor.DEFAULT);
            this.$set[$$].set([[K.SITE, this.get_position()], [K.DRAG, false]]);
            return true;
        };
        return ret;
    }

    setDrag(drag) {
        if(drag) Main.layoutManager.trackChrome(this);
        else Main.layoutManager.untrackChrome(this);
        this.set_reactive(drag);
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
