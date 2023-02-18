// vim:fdm=syntax
// by tuberry
/* exported Lyric */
'use strict';

const { Soup, GLib, Gio } = imports.gi;

const SEARCH = 'https://music.163.com/weapi/search/get';
const GETLRC = 'https://music.163.com/api/song/lyric?';

const base62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ivHex = "30313032303330343035303630373038";
const presetKeyHex = "30436f4a556d365179773857386a7564";
const publicKey = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----";

const noop = () => {};

Gio._promisify(Gio.File.prototype, 'delete_async');
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

    async fetch(song) {
        let info = this.info(song);
        let ans1 = JSON.parse(await this.visit('POST', SEARCH, this.getEnc({ s: info, limit: '30', type: '1', offset: '0' })));
        if(ans1.code !== Soup.Status.OK) throw new Error(`${info} not found, ${JSON.stringify(ans1, null, 0)}`);
        let ans2 = JSON.parse(await this.visit('GET', GETLRC, { id: this.getSongId(ans1, song), lv: '1' })); // kv: '0', tv: '0'
        if(ans2.code !== Soup.Status.OK) throw new Error(`Lyric of ${info} not found, ${JSON.stringify(ans2, null, 0)}`);
        if(!ans2.lrc?.lyric) throw new Error('Empty lyric');
        Gio.File.new_for_path(this.path(song))
            .replace_contents_async(new TextEncoder().encode(ans2.lrc.lyric), null, false, Gio.FileCreateFlags.NONE, null).catch(noop);
        return ans2.lrc.lyric;
    }

    delete(song) {
        let info = encodeURIComponent(this.info(song));
        console.warn(`Desktop Lyric: failed to download lyric for <${song.title}>, see: ${SEARCH}s=${info}&limit=30&type=1`);
        Gio.File.new_for_path(this.path(song)).delete_async(GLib.PRIORITY_DEFAULT, null).catch(noop); // ignore NOT_FOUND
    }

    getSongId(ans, song) {
        let attr = ['title', 'artist', 'album'].filter(x => song[x].toString());
        if(ans.result.abroad) throw new Error('abroad');
        return ans.result.songs.map(({ id, name: title, album: x, artists: y }) => ({ id, title, album: x.name, artist: y.map(z => z.name).sort() }))
            .find(x => attr.every(y => x[y].toString().includes(song[y].toString()))).id.toString();
    }

    async find(song) {
        let file = Gio.File.new_for_path(this.path(song));
        if(await file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null).catch(noop)) {
            let [contents] = await file.load_contents_async(null);
            return new TextDecoder().decode(contents);
        } else {
            return this.fetch(song);
        }
    }

    info({ title, artist }) {
        return [title, artist.join(' ')].filter(x => x).join(' ');
    }

    path({ title, artist, album }) { // default to $XDG_CACHE_DIR/desktop-lyric if exists
        let fn = [title, artist.join(','), album].filter(x => x).join('-').replaceAll('/', ',').concat('.lrc');
        return this.location ? `${this.location}/${fn}` : GLib.build_filenamev([GLib.get_user_cache_dir(), 'desktop-lyric', fn]);
    }

    encrypt(mode, text, key, iv) {
        let enc;
        let script;
        if(mode === "aes") script = `echo "${GLib.base64_encode(text)}" | base64 -d | openssl enc -aes-128-cbc -K ${key} -iv ${iv} -a -A`;
        else if(mode === "rsa") script = `echo "${GLib.base64_encode(text.padStart(128, "\0"))}" | base64 -d | openssl pkeyutl -encrypt -pubin -inkey <(echo "${key}") -pkeyopt rsa_padding_mode:none | base64`;
        let loop = GLib.MainLoop.new(null, false);
        let proc = Gio.Subprocess.new(["bash", "-c", script], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        proc.communicate_utf8_async(null, null, (proc, res) => {
            try {
                let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                if(proc.get_successful()) enc = stdout;
                else throw new Error(stderr);
            } catch (e) {
                logError(e);
            } finally {
                loop.quit();
            }
        });
        loop.run();
        return enc;
    }

    getEnc(object) {
        const text = JSON.stringify(object);
        let secretKey = "";
        for(let i = 0; i < 16; i++) secretKey += base62.charAt(Math.floor(Math.random() * base62.length));
        return {
            params: this.encrypt("aes", this.encrypt("aes", text, presetKeyHex, ivHex), Array.prototype.map.call(secretKey, (x) => x.charCodeAt(0).toString(16).padStart(2, "0")).join(""), ivHex),
            encSecKey: Array.prototype.map.call(GLib.base64_decode(this.encrypt("rsa", secretKey.split("").reverse().join(""), publicKey)), (x) => x.toString(16).padStart(2, "0")).join(""),
        };
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
};
