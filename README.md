# desktop-lyric

Show the lyric of playing songs on the desktop.
>很多歌消失了。 —— *汪曾祺 《徙》*<br>
[![license]](/LICENSE)
<br>

![bee](https://user-images.githubusercontent.com/17917040/107332354-08111f80-6aef-11eb-9c7a-f8799c834501.png)

## Installation

### Manual

The latest and supported version should only work on the most current stable version of GNOME Shell.

```bash
git clone https://github.com/tuberry/desktop-lyric.git && cd desktop-lyric
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For contributing translations:

```bash
bash ./cli/update-po.sh your_lang_code # default to $LANG
```

For older versions (< 44), it's recommended to install via:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

![dlpref](https://user-images.githubusercontent.com/17917040/155883047-593e79cb-9647-4c9c-bbbd-665c90719305.png)


## Note

* High CPU usage;
* The missing lyrics will be downloaded from [NetEase];
* The lyric ([LRC] format) filename format is ~~`Title-Artist1,Artist2.lrc`~~(**no longer in use, please delete them**)`Title-Artist1,Artist2-Album.lrc`;
* Draw at an even pace so that exact synchronization with the song is not guaranteed;

## Acknowledgements

* [lyrics-finder]: online lyrics
* [osdlyrics]: some names

[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[LRC]:https://en.wikipedia.org/wiki/LRC_(file_format)
[NetEase]:http://music.163.com/
[lyrics-finder]:https://github.com/TheWeirdDev/lyrics-finder-gnome-ext
[osdlyrics]:https://github.com/osdlyrics/osdlyrics
[EGO]:https://extensions.gnome.org/extension/4006/desktop-lyric/
