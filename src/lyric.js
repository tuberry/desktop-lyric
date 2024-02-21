// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

import {Destroyable, symbiose, getSelf} from './fubar.js';
import {noop, id, homolog, decode, fopen, fwrite, fread, request, cancelled, fdelete} from './util.js';

const GETLRC = 'https://music.163.com/api/song/lyric?';
const SEARCH = 'https://music.163.com/api/search/get/web?';

export class Lyric extends Destroyable {
    constructor() {
        super();
        this._http = new Soup.Session({timeout: 30});
        this._sbt = symbiose(this, () => this._http.abort(), {
            cancel: [x => x?.cancel(), () => new Gio.Cancellable()],
        });
    }

    static format({title, artist, album}, sep_title = ' ', sep_artist = ' ', use_album = false) {
        return [title, artist.join(sep_artist), use_album ? album : ''].filter(id).join(sep_title);
    }

    match({title: x, album: y, artist: z}, {name: u, album: {name: v}, artists: w}) {
        return (!x || x === u) && (!y || y === v) && (!z.length || homolog(z, w.map(a => a.name).sort()));
    }

    async fetch(song, cancel) {
        let {songs} = JSON.parse(await request('POST', SEARCH, {s: Lyric.format(song), limit: '30', type: '1'}, this._http, cancel)).result;
        return JSON.parse(await request('GET', GETLRC, {id: songs.find(x => this.match(song, x)).id.toString(), lv: '1'}, this._http, cancel)).lrc; // kv: '0', tv: '0'
    }

    async load(song, fetch) {
        let file = fopen(this.path(song));
        let cancel = this._sbt.cancel.revive();
        try {
            if(fetch) throw Error('dirty');
            let [contents] = await fread(file, cancel);
            return decode(contents);
        } catch(e) {
            if(cancelled(e)) throw Error('cancelled');
            try {
                let {lyric} = await this.fetch(song, cancel);
                fwrite(file, lyric || ' ').catch(noop);
                return lyric;
            } catch(e1) {
                if(fetch) this.warn(song, file);
                throw e1;
            }
        }
    }

    warn(song, file) {
        fdelete(file).catch(noop); // ignore NOT_FOUND
        let {uuid} = getSelf(),
            path = this.path(song) || song.title,
            info = encodeURIComponent(Lyric.format(song));
        console.warn(`[${uuid}]`, `failed to download <${path}>, see: ${SEARCH}s=${info}&limit=30&type=1 and ${GETLRC}&id=&lv=1`);
    }

    path(song) {
        return this.location ? `${this.location}/${Lyric.format(song, '-', ',', true).replaceAll('/', '／')}.lrc` : '';
    }
}
