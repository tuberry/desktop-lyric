// vim:fdm=syntax
// by tuberry
//
'use strict';
const { Soup, GLib, Gio, GObject } = imports.gi;

const SEARCH = 'http://music.163.com/api/search/pc?';
const GETLRC = 'https://music.163.com/api/song/lyric?';

var Lyric = GObject.registerClass({
    Properties: {
        'location': GObject.ParamSpec.string('location', 'location', 'location', GObject.ParamFlags.READWRITE, ''),
    },
}, class Lyric extends GObject.Object {
    _init() {
        super._init();
        this.http = new Soup.Session();
    }

    async visit(method, url, param) {
        let message = Soup.Message.new_from_encoded_form(method, url, Soup.form_encode_hash(param));
        let bytes = await this.http.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if(message.statusCode !== Soup.Status.OK)
            throw new Error('Unexpected response: %s'.format(Soup.Status.get_phrase(statusCode)));

        return new TextDecoder().decode(bytes.get_data());
    }

    async fetch(title, artists) {
        let info = artists ? title + ' ' + artists.join('/') : title;
        let result = JSON.parse(await this.visit('POST', SEARCH, { s: info, limit: '1', type: '1' })).result;
        if(!result.songCount) throw new Error('Empty search result for %s'.format(info));
        let answer = JSON.parse(await this.visit('GET', GETLRC, { id: result.songs[0].id.toString(), lv: '1', kv: '0', tv: '0' }));
        if(!answer.lrc) throw new Error('Lyric of %s not found'.format(info));
        let file = Gio.File.new_for_path(this.path(title, artists));
        if(file.query_exists(null)) file.replace_contents(answer.lrc.lyric, null, false, Gio.FileCreateFlags.NONE, null);

        return answer.lrc.lyric;
    }

    find(title, artists, callback) {
        let file = Gio.File.new_for_path(this.path(title, artists));
        if(file.query_exists(null)) {
            let [ok, contents] = file.load_contents(null);
            if(ok) callback(new TextDecoder().decode(contents));
        } else {
            callback('');
            this.fetch(title, artists).then(callback);
        }
    }

    path(title, artists) {
        let filename = artists.length
            ? '%s-%s.lrc'.format(title, artists.join(',')).replace(/\//g, ',')
            : '%s.lrc'.format(title).replace(/\//g, ',');

        return this.location ? this.location + '/' + filename
            : GLib.build_filenamev([GLib.get_home_dir(),  '.lyrics', filename]);
    }

    destroy() {
        delete this.http;
    }
});

