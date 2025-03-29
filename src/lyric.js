// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Soup from 'gi://Soup';

import {Field} from './const.js';
import * as Util from './util.js';
import * as Fubar from './fubar.js';

class NeteaseProvider {
    static getlrc = 'https://music.163.com/api/song/lyric?';
    static search = 'https://music.163.com/api/search/get/web?';

    static #match({title: x, album: y, artist: z}, {name: u, album: {name: v}, artists: w}) {
        return x === u && (!y || y === v) && (!z.length || Util.homolog(z, w.map(a => a.name).sort()));
    }

    static async fetch(song, client, cancel = null, fallback = false) {
        let {songs} = JSON.parse(await Util.request('POST', this.search, {s: [song.title, ...song.artist].join(' '), limit: '30', type: '1'}, null, cancel, client)).result;
        if(fallback)
            return JSON.parse(await Util.request('GET', this.getlrc, {id: songs.find(x => (this.#match(song, x)) || songs[0]).id.toString(), lv: '1'}, null, cancel, client)).lrc.lyric; // kv: '0', tv: '0'
        else
            return JSON.parse(await Util.request('GET', this.getlrc, {id: songs.find(x => this.#match(song, x)).id.toString(), lv: '1'}, null, cancel, client)).lrc.lyric; // kv: '0', tv: '0'
    }
}

class LRCLIBProvider {
    static getlrc = 'https://lrclib.net/api/get?';
    static search = 'https://lrclib.net/api/search?';
    static header = {'Lrclib-Client': `desktop-lyric (https://github.com/tuberry/desktop-lyric)`}
    
    static async fetch(song, client, cancel = null, fallback = false) {
        if (fallback)
            return JSON.parse(await Util.request('GET', this.search, {q: [song.title, ...song.artist].join(' ')}, this.header, cancel, client))[0].syncedLyrics;
        else
            return JSON.parse(await Util.request('GET', this.getlrc, {track_name: song.title, artist_name: song.artist.join(', ')}, this.header, cancel, client)).syncedLyrics;
    }
}

const Providers = [NeteaseProvider, LRCLIBProvider];

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
            provider: [Field.PROV, 'uint'],
            fallback: [Field.FABK, 'boolean', null, () => {}],
        }, this);
    }

    #buildSources() {
        let cancel = Fubar.Source.newCancel();
        let client = new Fubar.Source(() => new Soup.Session({timeout: 30}), x => x?.abort(), this.online);
        this.$src = Fubar.Source.tie({cancel, client}, this);
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
                let lyric = await Providers[this.provider].fetch(song, this.$src.client.hub, cancel, this.fallback);
                console.warn("Desktop Lyric: fetched", this.online, this.provider);
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
