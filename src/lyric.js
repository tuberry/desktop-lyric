// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Soup from 'gi://Soup';

import {Field} from './const.js';
import {Mortal, Source, myself} from './fubar.js';
import {noop, id, homolog, decode, fopen, fwrite, fread, request, fdelete} from './util.js';

const GETLRC = 'https://music.163.com/api/song/lyric?';
const SEARCH = 'https://music.163.com/api/search/get/web?';

export class Lyric extends Mortal {
    static format({title, artist, album}, sepTile = ' ', sepArtist = ' ', useAlbum = false) {
        return [title, artist.join(sepArtist), useAlbum ? album : ''].filter(id).join(sepTile);
    }

    constructor(set) {
        super();
        this.$src = Source.fuse({
            cancel: Source.newCancel(),
            client: new Source(() => new Soup.Session({timeout: 30}), x => x?.abort()),
        }, this);
        this.$set = set.attach({
            path: [Field.PATH, 'string'],
            http: [Field.ONLN, 'boolean', x => this.$src.client.toggle(x)],
        }, this);
    }

    match({title: x, album: y, artist: z}, {name: u, album: {name: v}, artists: w}) {
        return x === u && (!y || y === v) && (!z.length || homolog(z, w.map(a => a.name).sort()));
    }

    async fetch(song, client, cancel = null) {
        let {songs} = JSON.parse(await request('POST', SEARCH, {s: Lyric.format(song), limit: '30', type: '1'}, cancel, client)).result;
        return JSON.parse(await request('GET', GETLRC, {id: songs.find(x => this.match(song, x)).id.toString(), lv: '1'}, cancel, client)).lrc; // kv: '0', tv: '0'
    }

    async load(song, refetch, cancel = this.$src.cancel.reborn()) {
        let file = fopen(this.filename(song));
        try {
            if(refetch) throw Error('dirty');
            let [contents] = await fread(file, cancel);
            return decode(contents);
        } catch(e) {
            if(Source.cancelled(e) || !this.$src.client.active) throw e;
            try {
                let {lyric} = await this.fetch(song, this.$src.client.hub, cancel);
                fwrite(file, lyric || ' ').catch(noop);
                return lyric;
            } catch(e1) {
                if(refetch) this.warn(song, file);
                throw e1;
            }
        }
    }

    warn(song, file) {
        fdelete(file).catch(noop); // ignore NOT_FOUND
        let {uuid} = myself(),
            path = this.filename(song) || song.title,
            info = encodeURIComponent(Lyric.format(song));
        console.warn(`[${uuid}]`, `failed to download <${path}>, see: ${SEARCH}s=${info}&limit=30&type=1 and ${GETLRC}&id=&lv=1`);
    }

    filename(song) {
        return this.path ? `${this.path}/${Lyric.format(song, '-', ',', true).replaceAll('/', '／')}.lrc` : '';
    }
}
