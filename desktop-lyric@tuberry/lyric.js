// vim:fdm=syntax
// by tuberry
// Ref: https://github.com/TheWeirdDev/lyrics-finder-gnome-ext/blob/master/lyrics_api.js
//
const ByteArray = imports.byteArray;
const { Soup, GLib, Gio, GObject } = imports.gi;

var Lyric = GObject.registerClass(
class Lyric extends GObject.Object {
    _init() {
        super._init();
        this.httpSession = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(this.httpSession, new Soup.ProxyResolverDefault());
    }

    fetch(title, artist, callback) {
        let uri = new Soup.URI('http://music.163.com/api/search/pc?s=%s %s&type=1&limit=1'.format(title, artist.split('/')[0]));
        let request = Soup.Message.new_from_uri('GET', uri);
        this.httpSession.queue_message(request, (httpSession, message) => {
            if (message.status_code != 200) return;
            let data = JSON.parse(message.response_body.data);
            if (data.code != 200 || data.result.songCount < 1) return;
            let song = Array.from(data.result.songs)[0];
            if(!song || !song.id) return;
            let request = Soup.Message.new('POST', 'http://music.163.com/api/song/lyric?os=pc&id=%d&lv=1'.format(song.id));
            this.httpSession.queue_message(request, (httpSession, message) => {
                if (message.status_code != 200) return;
                let data = JSON.parse(message.response_body.data);
                if (data.code != 200 || !data.lrc) return;
                let lyric = data.lrc.lyric;
                callback(lyric);
                Gio.file_new_for_path(this.path(title, artist)).replace_contents(lyric, null, false, Gio.FileCreateFlags.NONE, null);
            });
        });
    }

    find(title, artist, callback) {
        let file = Gio.file_new_for_path(this.path(title, artist));
        if(file.query_exists(null)) {
            let [ok, contents] = file.load_contents(null);
            callback(ByteArray.toString(contents));
        } else {
            callback('');
            this.fetch(title, artist, callback);
        }
    }

    path(title, artist) {
        let filename = artist ? '%s-%s.lrc'.format(title, artist) : '%s.lrc'.format(title);
        return GLib.build_filenamev([GLib.get_home_dir(),  '.lyrics', filename.replace(/\//g, ',')]);
    }

    destroy() {
        this.httpSession = null;
    }
});

