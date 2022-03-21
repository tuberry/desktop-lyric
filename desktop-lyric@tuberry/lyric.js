// vim:fdm=syntax
// by tuberry
/* exported Lyric */
'use strict';

const { Soup, GLib, Gio, GObject } = imports.gi;

const SEARCH = 'http://music.163.com/api/search/get/web?';
const GETLRC = 'https://music.163.com/api/song/lyric?';

const noop = () => {};
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');

var Lyric = class extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                location: genParam('string', 'location', ''),
            },
        }, this);
    }

    constructor() {
        super();
        this._session = new Soup.Session({ timeout: 30 });
    }

    async visit(method, url, param) {
        let message = Soup.Message.new_from_encoded_form(method, url, Soup.form_encode_hash(param));
        let bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if(message.statusCode !== Soup.Status.OK) throw new Error(`Unexpected response: ${Soup.Status.get_phrase(message.statusCode)}`);

        return new TextDecoder().decode(bytes.get_data());
    }

    async fetch(title, artists) {
        let info = artists ? `${title} ${artists.join('/')}` : title;
        let ans1 = JSON.parse(await this.visit('POST', SEARCH, { s: info, limit: '1', type: '1' }));
        if(ans1.code !== Soup.Status.OK) throw new Error(`${info} not found. Message: ${JSON.stringify(ans1, null, 0)}`);
        let ans2 = JSON.parse(await this.visit('GET', GETLRC, { id: ans1.result.songs[0].id.toString(), lv: '1', kv: '0', tv: '0' }));
        if(ans2.code !== Soup.Status.OK) throw new Error(`Lyric of ${info} not found. Message: ${JSON.stringify(ans2, null, 0)}`);
        if(!ans2.lrc.lyric) throw new Error('Empty lyric');
        let file = Gio.File.new_for_path(this.path(title, artists));
        await file.replace_contents_async(new TextEncoder().encode(ans2.lrc.lyric), null, false, Gio.FileCreateFlags.NONE, null);

        return ans2.lrc.lyric;
    }

    async find(title, artists) {
        let file = Gio.File.new_for_path(this.path(title, artists));
        if(await file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null).catch(noop)) {
            let [contents] = await file.load_contents_async(null);
            return new TextDecoder().decode(contents);
        } else {
            return this.fetch(title, artists);
        }
    }

    path(title, artists) {
        let filename = artists.length
            ? `${title}-${artists.join(',')}.lrc`.replace(/\//g, ',')
            : `${title}.lrc`.replace(/\//g, ',');

        return this.location ? `${this.location}/${filename}`
            : GLib.build_filenamev([GLib.get_home_dir(), '.lyrics', filename]);
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
};
