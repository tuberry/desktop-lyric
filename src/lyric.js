// vim:fdm=syntax
// by tuberry

import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

import { Destroyable, symbiose, getSelf } from './fubar.js';
import { noop, id, homolog, decode, fopen, fwrite, fread, access, cancelled, fdelete } from './util.js';

const GETLRC = 'https://music.163.com/api/song/lyric?';
const SEARCH = 'http://music.163.com/api/search/get/web?';

export class Lyric extends Destroyable {
    constructor() {
        super();
        this._session = new Soup.Session({ timeout: 30 });
        this._sbt = symbiose(this, () => this._session.abort(), {
            cancel: [x => x?.cancel(), () => new Gio.Cancellable()],
        });
    }

    static format({ title, artist, album }, sep_title = ' ', sep_artist = ' ', use_album = false) {
        return [title, artist.join(sep_artist), use_album ? album : ''].filter(id).join(sep_title);
    }

    match({ title: x, album: y, artist: z }, { name: u, album: { name: v }, artists: w }) {
        return (!x || x === u) && (!y || y === v) && (!z.length || homolog(z, w.map(a => a.name).sort()));
    }

    async fetch(song, cancel) {
        let { songs } = JSON.parse(await access('POST', SEARCH, { s: Lyric.format(song), limit: '30', type: '1' }, this._session, cancel)).result;
        return JSON.parse(await access('GET', GETLRC, { id: songs.find(x => this.match(song, x)).id.toString(), lv: '1' }, this._session, cancel)).lrc.lyric; // kv: '0', tv: '0'
    }

    async find(song, fetch) {
        let file = fopen(this.path(song));
        let cancel = this._sbt.cancel.revive();
        try {
            if(fetch) throw Error('dirty');
            let [contents] = await fread(file, cancel);
            return decode(contents);
        } catch(e) {
            if(cancelled(e)) throw Error('cancelled');
            let lyric = '';
            try {
                lyric = await this.fetch(song, cancel);
                fwrite(file, lyric || ' ').catch(noop);
            } catch(e1) {
                if(cancelled(e1)) throw Error('cancelled');
                else if(fetch) this.warn(song, file);
            }
            return lyric;
        }
    }

    warn(song, file) {
        fdelete(file).catch(noop); // ignore NOT_FOUND
        let name = getSelf().metadata.name,
            path = this.path(song) || song.title,
            info = encodeURIComponent(Lyric.format(song));
        console.warn(`[${name}]`, `failed to download <${path}>, see: ${SEARCH}s=${info}&limit=30&type=1 and ${GETLRC}&id=&lv=1`);
    }

    path(song) {
        return this.location ? `${this.location}/${Lyric.format(song, '-', ',', true).replaceAll('/', '／')}.lrc` : '';
    }
}
