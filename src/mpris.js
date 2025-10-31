// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';
import {PlayerScanner} from './player-scanner.js';
import {PlayerSelector} from './player-selector.js';

const MPRIS_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2');
const PLAYER_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2.Player');

/**
 * Mpris - Main MPRIS manager class (refactored)
 * Delegates scanning to PlayerScanner and selection to PlayerSelector
 */
export default class Mpris extends F.Mortal {
    constructor(gset) {
        super();
        this.$set = gset;
        this.availablePlayers = new Map();
        this.scanner = new PlayerScanner(gset);
        this.selector = new PlayerSelector();
        this.isRescanning = false;
        this.manuallySelected = false;
        
        this.buildSources(FileUtils.loadInterfaceXML('org.gnome.Shell.Extensions.DesktopLyric.MprisPlayer'));
        
        // Listen for setting changes
        this.$set.hub.connect(`changed::${K.AVPL}`, () => this.onSettingChanged());
        this.$set.hub.connect(`changed::${K.PMPL}`, () => this.onPreferredPlayerChanged());
    }

    buildSources(playerIface) {
        let dbus = new F.DBusProxy('org.freedesktop.DBus', '/org/freedesktop/DBus', 
            x => x && setTimeout(() => this.rescanAndSelectPlayer(), 0), 
            null,
            [['NameOwnerChanged', (_p, _s, [name, old, neo]) => { 
                if (neo && !old) this.onNewPlayer(name);
                else if (old && !neo) this.onPlayerDisappeared(name);
            }]]),
            mpris = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', 
                y => y && this.$src.player.revive(y.gName),
                [['notify::g-name-owner', (...xs) => this.onMprisChange(...xs)]], 
                null, MPRIS_IFACE)),
            player = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', 
                (...xs) => this.onPlayerReady(...xs),
                [['g-properties-changed', (...xs) => this.onPlayerChange(...xs)]], 
                [['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)]], 
                playerIface));
        this.$src = F.Source.tie({dbus, mpris, player}, this);
    }

    activate(active) {
        this.emit('active', this.active = active);
    }

    rescanAndSelectPlayer() {
        if (this.isRescanning) return;
        this.isRescanning = true;
        
        const wasActive = this.active;
        const currentPlayer = this.$src.mpris.hub?.gName;
        
        // Clean up old player proxies
        this.scanner.cleanup();
        this.availablePlayers.clear();
        
        // Re-scan all D-Bus names
        try {
            this.$src.dbus.ListNamesAsync(([xs]) => {
                const promises = xs.map(x => this.scanPlayer(x).catch(T.nop));
                Promise.allSettled(promises).then(() => {
                    if (this.availablePlayers.size > 0) {
                        this.handlePlayersAvailable(currentPlayer);
                    } else {
                        this.handleNoPlayers(wasActive);
                    }
                    this.isRescanning = false;
                }).catch(() => {
                    this.isRescanning = false;
                });
            });
        } catch (e) {
            this.isRescanning = false;
        }
    }

    handlePlayersAvailable(currentPlayer) {
        const currentPlayerExists = currentPlayer && this.availablePlayers.has(currentPlayer);
        const preferred = this.$set.hub.get_string(K.PMPL);
        
        if (!currentPlayerExists) {
            this.selectAndActivatePlayer();
        } else if (!preferred && this.selector.shouldAutoSwitch(currentPlayer, this.availablePlayers)) {
            this.selectAndActivatePlayer();
        }
    }

    handleNoPlayers(wasActive) {
        if (wasActive) {
            this.$src.mpris.dispel();
            this.$src.player.dispel();
            this.activate(false);
        }
    }

    onSettingChanged() {
        this.rescanAndSelectPlayer();
    }

    onPreferredPlayerChanged() {
        this.$src.mpris.dispel();
        this.$src.player.dispel();
        this.activate(false);
        this.selectPreferredPlayer();
    }

    async scanPlayer(name) {
        const info = await this.scanner.scanPlayer(name, (name, status) => {
            this.onAnyPlayerStatusChanged(name, status);
        });
        this.availablePlayers.set(name, info);
    }

    selectAndActivatePlayer() {
        const preferred = this.$set.hub.get_string(K.PMPL);
        const currentPlayer = this.$src.mpris.hub?.gName;
        const selected = this.selector.selectPlayer(this.availablePlayers, preferred, currentPlayer);
        
        if (selected) {
            this.$src.mpris.summon(selected);
        } else {
            this.$src.mpris.dispel();
            this.$src.player.dispel();
            this.activate(this.availablePlayers.size > 0);
            this.manuallySelected = false;
        }
    }

    selectPreferredPlayer() {
        this.selectAndActivatePlayer();
    }

    getAvailablePlayers() {
        return Array.from(this.availablePlayers.keys());
    }

    getPlayerInfo(name) {
        return this.availablePlayers.get(name) || {isVideo: false, currentTitle: null};
    }

    async refreshPlayerTitle(name) {
        const title = await this.scanner.refreshPlayerTitle(name);
        const info = this.availablePlayers.get(name);
        if (info && title) {
            info.currentTitle = title;
        }
    }

    isCurrentPlayerVideo() {
        const currentPlayer = this.$src.mpris.hub?.gName;
        if (!currentPlayer) return false;
        const info = this.availablePlayers.get(currentPlayer);
        return info?.isVideo || false;
    }

    shouldSearchLyrics() {
        if (this.isCurrentPlayerVideo()) {
            return this.manuallySelected;
        }
        return true;
    }

    getPreferredPlayer() {
        return this.$set.hub.get_string(K.PMPL);
    }

    setPreferredPlayer(name, isManual = false) {
        this.$set.hub.set_string(K.PMPL, name || '');
        this.manuallySelected = isManual && name && name !== 'none';
    }

    onPlayerReady(proxy) {
        if (!proxy) return;
        this.activate(true);
        this.update(proxy.Metadata);
    }

    async onNewPlayer(name) {
        try {
            await this.scanPlayer(name);
            
            const preferred = this.$set.hub.get_string(K.PMPL);
            const newPlayerInfo = this.availablePlayers.get(name);
            const currentPlayer = this.$src.mpris.hub?.gName;
            
            if (this.selector.shouldActivateNewPlayer(
                name, newPlayerInfo, currentPlayer, preferred, this.$src.mpris.active
            )) {
                this.$src.mpris.summon(name);
            }
        } catch (e) {
            // Player is not valid, ignore
        }
    }

    onPlayerDisappeared(name) {
        if (name.startsWith('org.mpris.MediaPlayer2.')) {
            this.availablePlayers.delete(name);
            this.scanner.cleanupPlayer(name);
        }
    }

    onMprisChange(proxy) {
        if (proxy?.gNameOwner) return;
        if (!this.isRescanning) {
            this.rescanAndSelectPlayer();
        }
    }

    onAnyPlayerStatusChanged(name, newStatus) {
        const info = this.availablePlayers.get(name);
        if (info) {
            info.playbackStatus = newStatus;
        }
        
        const preferred = this.$set.hub.get_string(K.PMPL);
        if (!preferred) {
            const currentPlayer = this.$src.mpris.hub?.gName;
            
            if (newStatus === 'Playing' && name !== currentPlayer) {
                this.$src.mpris.summon(name);
            } else if (currentPlayer && this.selector.shouldAutoSwitch(currentPlayer, this.availablePlayers)) {
                this.selectAndActivatePlayer();
            }
        }
    }

    onPlayerChange(proxy, prop) {
        if (prop.lookup_value('Metadata', null)) this.update(proxy.Metadata);
        if (prop.lookup_value('PlaybackStatus', null)) {
            this.emit('status', this.status);
        }
    }

    update(metadata) {
        let {
            'xesam:title': title, 
            'xesam:artist': artist, 
            'xesam:asText': lyric,
            'xesam:album': album, 
            'mpris:length': length = 0,
        } = T.vmap(metadata, v => v.deepUnpack());
        
        if (!T.str(title) || !title) return;
        
        this.emit('update', {
            artist: artist?.every?.(T.str) ? artist.flatMap(x => x.split('/')).filter(T.id) : [],
            length: length / 1000, 
            album: T.str(album) ? album : '', 
            lyric: T.str(lyric) ? lyric : null, 
            title,
        });
    }

    async getPosition() {
        let pos = await Gio.DBus.session.call(
            this.$src.mpris.hub.gName, 
            '/org/mpris/MediaPlayer2', 
            'org.freedesktop.DBus.Properties',
            'Get', 
            T.pickle(['org.mpris.MediaPlayer2.Player', 'Position']), 
            null, 
            Gio.DBusCallFlags.NONE, 
            -1, 
            null
        );
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.player.hub?.PlaybackStatus === 'Playing';
    }
}
