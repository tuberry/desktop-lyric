// vim:fdm=syntax
// by tuberry
/* exported Lyric */
'use strict';

const { Soup, GLib, Gio } = imports.gi;

const SEARCH = 'http://music.163.com/api/search/get/web?';
const GETLRC = 'https://music.163.com/api/song/lyric?';

const noop = () => {};

Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');

var Lyric = class {
    constructor() {
        this._session = new Soup.Session({ timeout: 30 });
    }

    async visit(method, url, param) {
        let message = Soup.Message.new_from_encoded_form(method, url, Soup.form_encode_hash(param));
        let bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if(message.statusCode !== Soup.Status.OK) throw new Error(`Unexpected response: ${message.get_reason_phrase()}`);
        return new TextDecoder().decode(bytes.get_data());
    }

    async fetch(title, artist, album) {
        let info = [title, artist.join(' ')].filter(Boolean).join(' ');
        let ans1 = JSON.parse(await this.visit('POST', SEARCH, { s: info, limit: '15', type: '1' }));
        if(ans1.code !== Soup.Status.OK) throw new Error(`${info} not found, ${JSON.stringify(ans1, null, 0)}`);
        let ans2 = JSON.parse(await this.visit('GET', GETLRC, { id: this.getSongId(ans1, title, artist, album), lv: '1' })); // kv: '0', tv: '0'
        if(ans2.code !== Soup.Status.OK) throw new Error(`Lyric of ${info} not found, ${JSON.stringify(ans2, null, 0)}`);
        if(!ans2.lrc?.lyric) throw new Error('Empty lyric');
        Gio.File.new_for_path(this.path(title, artist, album))
            .replace_contents_async(new TextEncoder().encode(ans2.lrc.lyric), null, false, Gio.FileCreateFlags.NONE, null).catch(noop);
        return ans2.lrc.lyric;
    }

    delete(title, artist, album) {
        let info = encodeURIComponent([title, artist.join(' ')].filter(Boolean).join(' '));
        console.log(`Desktop Lyric: failed to download lyric for 《${title}》, see: ${SEARCH}s=${info}&limit=15&type=1`);
        Gio.File.new_for_path(this.path(title, artist, album)).delete_async(GLib.PRIORITY_DEFAULT, null).catch(noop); // ignore NOT_FOUND
    }

    getSongId(ans, title, singers, a_name) {
        let artist = (singers.some(x => x.includes('/')) ? singers.join('/').split('/') : singers).sort().toString(); // ehm
        return ans.result.songs.map(({ name, id, artists, album }) => ({ id, name, album: album.name, artist: artists.map(x => x.name).filter(Boolean) }))
            .find(x => x.name === title && x.album === a_name && x.artist.sort().toString() === artist).id.toString();
    }

    async find(title, artist, album) {
        let file = Gio.File.new_for_path(this.path(title, artist, album));
        if(await file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null).catch(noop)) {
            let [contents] = await file.load_contents_async(null);
            return new TextDecoder().decode(contents);
        } else {
            return this.fetch(title, artist, album);
        }
    }

    path(title, artist, album) { // default to $XDG_CACHE_DIR/desktop-lyric if exists
        let fn = [title, artist.join(','), album].filter(Boolean).join('-').replace(/\//g, ',').concat('.lrc');
        return this.location ? `${this.location}/${fn}` : GLib.build_filenamev([GLib.get_user_cache_dir(), 'desktop-lyric', fn]);
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
};
