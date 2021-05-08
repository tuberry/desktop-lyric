// vim:fdm=syntax
// by tuberry
// Ref: https://github.com/TheWeirdDev/lyrics-finder-gnome-ext/blob/master/lyrics_api.js
//
'use strict';
const ByteArray = imports.byteArray;
const { Soup, GLib, Gio, GObject } = imports.gi;

var Lyric = GObject.registerClass({
    Properties: {
        'location': GObject.ParamSpec.string('location', 'location', 'location', GObject.ParamFlags.READWRITE, ''),
    },
}, class Lyric extends GObject.Object {
    _init() {
        super._init();
        this.http = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(this.http, new Soup.ProxyResolverDefault());
    }

    fetch(title, artist, callback) {
        let uri = new Soup.URI('http://music.163.com/api/search/pc?s=%s %s&type=1&limit=1'.format(title, artist.split('/')[0]));
        let request = Soup.Message.new_from_uri('POST', uri);
        this.http.queue_message(request, (session, message) => {
            if (message.status_code != Soup.KnownStatusCode.OK) return;
            let data = JSON.parse(message.response_body.data);
            if (data.code != 200 || data.result.songCount < 1) return;
            let song = Array.from(data.result.songs)[0];
            if(!song || !song.id) return;
            let request = Soup.Message.new('GET', 'http://music.163.com/api/song/media?id=%d'.format(song.id));
            this.http.queue_message(request, (session, message) => {
                if (message.status_code != Soup.KnownStatusCode.OK) return;
                let data = JSON.parse(message.response_body.data);
                if (data.code != 200 || !data.lyric) return;
                callback(data.lyric);
                Gio.File.new_for_path(this.path(title, artist)).replace_contents(data.lyric, null, false, Gio.FileCreateFlags.NONE, null);
            });
        });
    }

    find(title, artist, callback) {
        let file = Gio.File.new_for_path(this.path(title, artist));
        if(file.query_exists(null)) {
            let [ok, contents] = file.load_contents(null);
            callback(ByteArray.toString(contents));
        } else {
            callback('');
            this.fetch(title, artist, callback);
        }
    }

    path(title, artist) {
        let filename = artist ? '%s-%s.lrc'.format(title, artist).replace(/\//g, ',') : '%s.lrc'.format(title).replace(/\//g, ',');
        return this.location ? this.location + '/' + filename : GLib.build_filenamev([GLib.get_home_dir(),  '.lyrics', filename]);
    }

    destroy() {
        this.http = null;
    }
});

