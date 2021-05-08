# desktop-lyric

Show lyric of the playing song on the desktop.

>很多歌消失了。 —— *汪曾祺 《徙》*<br>
[![license]](/LICENSE)
<br>

![bee](https://user-images.githubusercontent.com/17917040/107332354-08111f80-6aef-11eb-9c7a-f8799c834501.png)

## Installation

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

Or manually:

```bash
git clone https://github.com/tuberry/desktop-lyric.git
cd desktop-lyric && make install
```

## Features

![dlprefs](https://user-images.githubusercontent.com/17917040/117526303-daa51680-aff6-11eb-8a53-da711c9be482.png)

## Note

* High CPU usage;
* Based on Mpris;
* The missing lyrics will be downloaded from [NetEase];
* The lyric ([LRC] format) filename format is `Title-Artist1,Artist2.lrc`;
* Draw at an even pace so that exact synchronization with the song is impossible;

## Acknowledgements

* [lyrics-finder]: online lyrics
* [osdlyrics]: some names

[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[LRC]:https://en.wikipedia.org/wiki/LRC_(file_format)
[NetEase]:http://music.163.com/
[lyrics-finder]:https://github.com/TheWeirdDev/lyrics-finder-gnome-ext
[osdlyrics]:https://github.com/osdlyrics/osdlyrics
[EGO]:https://extensions.gnome.org/extension/4006/desktop-lyric/