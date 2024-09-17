// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Soup from 'gi://Soup';

import {Field} from './const.js';
import * as Util from './util.js';
import * as Fubar from './fubar.js';

const GETLRC = 'https://music.163.com/api/song/lyric?';
const SEARCH = 'https://music.163.com/api/search/get/web?';

export class Lyric extends Fubar.Mortal {
    static name({title, artist, album}, sepTile = ' ', sepArtist = ' ', useAlbum = false) {
        return [title, artist.join(sepArtist), useAlbum ? album : ''].filter(Util.id).join(sepTile);
    }

    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildSources();
    }

    #bindSettings(set) {
        this.$set = set.attach({
            folder: [Field.PATH, 'string'],
            online: [Field.ONLN, 'boolean', null, x => this.$src.client.toggle(x)],
        }, this);
    }

    #buildSources() {
        let cancel = Fubar.Source.newCancel();
        let client = new Fubar.Source(() => new Soup.Session({timeout: 30}), x => x?.abort(), this.online);
        this.$src = Fubar.Source.tie({cancel, client}, this);
    }

    match({title: x, album: y, artist: z}, {name: u, album: {name: v}, artists: w}) {
        return x === u && (!y || y === v) && (!z.length || Util.homolog(z, w.map(a => a.name).sort()));
    }

    async fetch(song, client, cancel = null) {
        let {songs} = JSON.parse(await Util.request('POST', SEARCH, {s: Lyric.name(song), limit: '30', type: '1'}, cancel, client)).result;
        return JSON.parse(await Util.request('GET', GETLRC, {id: songs.find(x => this.match(song, x)).id.toString(), lv: '1'}, cancel, client)).lrc; // kv: '0', tv: '0'
    }

    async load(song, reload, cancel = this.$src.cancel.reborn()) {
        let file = Util.fopen(this.path(song));
        try {
            if(reload) throw Error('dirty');
            let [contents] = await Util.fread(file, cancel);
            return Util.decode(contents);
        } catch(e) {
            if(Fubar.Source.cancelled(e) || !this.$src.client.active) throw e;
            try {
                let {lyric} = await this.fetch(song, this.$src.client.hub, cancel);
                Util.fwrite(file, lyric || ' ').catch(Util.noop);
                return lyric;
            } catch(e1) {
                if(reload) this.warn(song, file);
                throw e1;
            }
        }
    }

    warn(song, file) {
        Util.fdelete(file).catch(Util.noop); // ignore NOT_FOUND
        let {uuid} = Fubar.myself(),
            path = this.path(song) || song.title,
            info = encodeURIComponent(Lyric.name(song));
        console.warn(`[${uuid}]`, `failed to download <${path}>, see: ${SEARCH}s=${info}&limit=30&type=1 and ${GETLRC}&id=&lv=1`);
    }

    path(song) {
        return this.folder && `${this.folder}/${Lyric.name(song, '-', ',', true).replaceAll('/', '／')}.lrc`;
    }
}
