// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Soup from 'gi://Soup';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K, URL} from './const.js';

class NeteaseProvider {
    static getlrc = `${URL.NCM}api/song/lyric?`;
    static search = `${URL.NCM}api/search/get/web?`;

    static #match({name: u, album: {name: v}, artists: w}, {title: x, album: y}, z) {
        return x === u && (!y || y === v) && (!z.length || T.homolog(z, w.map(a => a.name).sort()));
    }

    static async fetch(song, client, cancel, fallback) {
        let singer = song.artist.toSorted(),
            {songs} = JSON.parse(await T.request('POST', this.search, {s: Lyric.name(song), limit: '30', type: '1'}, cancel, null, client)).result,
            {id} = songs.toSorted((a, b) => Math.abs(a.duration - song.length) - Math.abs(b.duration - song.length)).find(x => this.#match(x, song, singer)) ?? (fallback && songs[0]);
        return JSON.parse(await T.request('GET', this.getlrc, {id: id.toString(), lv: '1'}, cancel, null, client)).lrc.lyric; // kv: '0', tv: '0'
    }
}

class LRCLIBProvider { // Ref: https://lrclib.net/docs
    static getlrc = `${URL.LRCLIB}api/get?`;
    static search = `${URL.LRCLIB}api/search?`;
    static header = {'User-Agent': 'Desktop Lyric/48 (https://github.com/tuberry/desktop-lyric)'}; // TODO: ? import metadata.json

    static #match({trackName: u, albumName: v, artistName: w}, {title: x, album: y}, z) {
        return x === u && (!y || y === v) && (!z || z === w.length);
    }

    static async fetch(song, client, cancel, fallback) {
        let length = song.length / 1000; // ms to s
        try {
            let {title: track_name, artist, album: album_name} = song;
            return JSON.parse(await T.request('GET', this.getlrc, {track_name, artist_name: artist.join(', '), album_name, duration: String(length)}, cancel, this.header, client)).syncedLyrics;
        } catch(e) {
            if(F.Source.cancelled(e)) throw e;
            let singer = song.artist.join(' ').length; // HACK: messy seprator: e.g. https://lrclib.net/api/search?q=%E5%A4%B1%E7%9C%A0%E9%A3%9E%E8%A1%8C
            let songs = JSON.parse(await T.request('GET', this.search, {q: Lyric.name(song)}, cancel, this.header, client));
            return (songs.toSorted((a, b) => Math.abs(a.duration - length) - Math.abs(b.duration - length)).find(x => this.#match(x, song, singer)) ?? (fallback && songs[0])).syncedLyrics;
        }
    }
}

const Providers = [NeteaseProvider, LRCLIBProvider];

export default class Lyric extends F.Mortal {
    static name({title, artist, album}, sepTitle = ' ', sepArtist = ' ', useAlbum = false) {
        return [title, artist.join(sepArtist), useAlbum ? album : ''].filter(T.id).join(sepTitle);
    }

    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildSources();
    }

    #bindSettings(set) {
        this.$set = set.tie([
            K.PATH, K.FABK, [K.PRVD, x => Providers[x]],
            [K.ONLN, null, x => this.$src.client.toggle(x)],
        ], this);
    }

    #buildSources() {
        let cancel = F.Source.newCancel();
        let client = new F.Source(() => new Soup.Session({timeout: 30}), x => x?.abort(), this[K.ONLN]);
        this.$src = F.Source.tie({cancel, client}, this);
    }

    async load(song, reload, cancel = this.$src.cancel.reborn()) {
        let file = T.fopen(this.path(song));
        try {
            if(reload) throw Error('dirty');
            let [contents] = await T.fread(file, cancel);
            return T.decode(contents);
        } catch(e) {
            if(F.Source.cancelled(e) || !this.$src.client.active) throw e;
            try {
                let lyric = await this[K.PRVD].fetch(song, this.$src.client.hub, cancel, this[K.FABK]);
                T.fwrite(file, lyric || ' ').catch(T.nop);
                return lyric;
            } catch(e1) {
                if(reload) T.fdelete(file).catch(T.nop), this.warn(song, file);
                throw e1;
            }
        }
    }

    unload(song) {
        T.seq(p => p && T.exist(p) && T.fwrite(p, ' ').catch(T.nop), this.path(song));
    }

    warn(song) {
        F.me().getLogger().warn(`Failed to download lyrics for <${Lyric.name(song)}>`);
    }

    path(song) {
        return this[K.PATH] && `${this[K.PATH]}/${Lyric.name(song, '-', ',', true).replaceAll('/', '／')}.lrc`;
    }
}
