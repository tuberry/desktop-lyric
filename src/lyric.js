// vim:fdm=syntax
// by tuberry
/* exported Lyric */
'use strict';

const { Soup, GLib } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { noop, dc, fl, fn, fwrite, fread, fdelete, access } = Me.imports.util;
const { Symbiont, DEventEmitter } = Me.imports.fubar;

const SEARCH = 'http://music.163.com/api/search/get/web?';
const GETLRC = 'https://music.163.com/api/song/lyric?';

var Lyric = class extends DEventEmitter {
    constructor() {
        super();
        this._session = new Soup.Session({ timeout: 30 });
        new Symbiont(() => { this._session.abort(); this._session = null; }, this);
    }

    async fetch(song) {
        let { result } = JSON.parse(await access('POST', SEARCH, { s: this.info(song), limit: '30', type: '1' }, this._session));
        if(result.abroad) throw new Error('Abroad');
        let attr = ['title', 'artist', 'album'].filter(x => song[x].length);
        let songId = result.songs.map(({ id, name: title, album: x, artists: y }) => ({ id, title, album: x.name, artist: y.map(z => z.name).sort() }))
            .find(x => attr.every(y => song[y].toString() === x[y].toString())).id.toString();
        return JSON.parse(await access('GET', GETLRC, { id: songId, lv: '1' }, this._session)).lrc; // kv: '0', tv: '0'
    }

    delete(song) {
        let info = encodeURIComponent(this.info(song));
        log(`Desktop Lyric: failed to download lyric for <${song.title}>, see: ${SEARCH}s=${info}&limit=30&type=1`);
        fdelete(fl(this.path(song))).catch(noop); // ignore NOT_FOUND
    }

    async find(song, fetch) {
        let file = fl(this.path(song));
        try {
            if(fetch) throw new Error();
            let [contents] = await fread(file);
            return dc(contents);
        } catch(e) {
            let { lyric } = await this.fetch(song);
            if(lyric) {
                await fwrite(file, lyric).catch(noop);
                return lyric;
            } else {
                throw new Error('Empty lyric');
            }
        }
    }

    info({ title, artist }) {
        return [title, artist.join(' ')].filter(x => x).join(' ');
    }

    path({ title, artist, album }) { // default to $XDG_CACHE_DIR/desktop-lyric if exists
        let name = [title, artist.join(','), album].filter(x => x).join('-').replaceAll('/', ',').concat('.lrc');
        return this.location ? `${this.location}/${name}` : fn(GLib.get_user_cache_dir(), 'desktop-lyric', name);
    }
};
