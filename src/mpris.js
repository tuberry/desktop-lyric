// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const MPRIS_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2');

export default class Mpris extends F.Mortal {
    constructor(gset) {
        super();
        this.$set = gset;
        this.availablePlayers = new Map(); // Track all available players
        this._isRescanning = false; // Flag to prevent recursive rescanning
        this.$buildSources(FileUtils.loadInterfaceXML('org.gnome.Shell.Extensions.DesktopLyric.MprisPlayer'));
        // Listen for setting changes
        this.$set.hub.connect(`changed::${K.AVPL}`, () => this.#onSettingChanged());
        this.$set.hub.connect(`changed::${K.PMPL}`, () => this.#onPreferredPlayerChanged());
    }

    $buildSources(playerIface) {
        let dbus = new F.DBusProxy('org.freedesktop.DBus', '/org/freedesktop/DBus', x => x && setTimeout(() => this.#rescanAndSelectPlayer(), 0), null,
                [['NameOwnerChanged', (_p, _s, [name, old, neo]) => { 
                    if(neo && !old) this.#onNewPlayer(name);
                    else if(old && !neo) this.#onPlayerDisappeared(name);
                }]]),
            mpris = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', y => y && this.$src.player.revive(y.gName),
                [['notify::g-name-owner', (...xs) => this.#onMprisChange(...xs)]], null, MPRIS_IFACE)),
            player = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', (...xs) => this.#onPlayerReady(...xs),
                [['g-properties-changed', (...xs) => this.#onPlayerChange(...xs)]], [['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)]], playerIface));
        this.$src = F.Source.tie({dbus, mpris, player}, this);
    }

    #activate(active) {
        this.emit('active', this.active = active);
    }

    #rescanAndSelectPlayer() {
        // Prevent recursive rescanning
        if (this._isRescanning) return;
        this._isRescanning = true;
        
        // Remember current state
        const wasActive = this.active;
        const currentPlayer = this.$src.mpris.hub?.gName;
        
        // Clear available players list
        this.availablePlayers.clear();
        
        // Re-scan all D-Bus names to find valid players (don't dispel anything yet)
        try {
            this.$src.dbus.ListNamesAsync(([xs]) => {
                const promises = xs.map(x => this.#scanPlayer(x).catch(T.nop));
                Promise.allSettled(promises).then(() => {
                
                // Decide what to do based on scan results
                if (this.availablePlayers.size > 0) {
                    // We have valid players
                    const shouldSwitch = !currentPlayer || !this.availablePlayers.has(currentPlayer);
                    
                    if (shouldSwitch) {
                        // Source will automatically dispel old connection when summoning new one
                        this.#selectAndActivatePlayer();
                    }
                } else {
                    // No valid players found - need to dispel and deactivate
                    if (wasActive) {
                        this.$src.mpris.dispel();
                        this.$src.player.dispel();
                        this.#activate(false);
                    }
                }
                
                // Reset rescanning flag
                this._isRescanning = false;
                }).catch((e) => {
                    this._isRescanning = false;
                });
            });
        } catch (e) {
            this._isRescanning = false;
        }
    }

    async #isPlayerValid(name) {
        // Check if a player name is valid according to current settings
        if(!name.startsWith('org.mpris.MediaPlayer2.')) return false;
        try {
            let {DesktopEntry, Identity} = await Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE).newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2'),
                app = DesktopEntry ? `${DesktopEntry}.desktop` : Identity ? Shell.AppSystem.search(Identity)[0]?.[0] : null,
                cat = app ? Shell.AppSystem.get_default().lookup_app(app)?.get_app_info().get_categories().split(';') : null;
            
            // Check if video players should be filtered out
            if(!this.$set.hub.get_boolean(K.AVPL) && cat?.reduce((p, x) => { p[0] &&= x !== 'AudioVideo'; p[1] ||= x === 'Video'; return p; }, [true, false]).some(T.id)) return false;
            
            return true;
        } catch (e) {
            return false;
        }
    }

    #onSettingChanged() {
        // When allow-video-players setting changes, rescan all players
        // The rescan will determine if current player is still valid
        this.#rescanAndSelectPlayer();
    }

    #onPreferredPlayerChanged() {
        // When preferred player changes, switch to it
        this.$src.mpris.dispel();
        this.$src.player.dispel();
        this.#activate(false);
        this.#selectPreferredPlayer();
    }

    async #scanPlayer(name) {
        // Only scan and record valid players, don't activate
        if(!name.startsWith('org.mpris.MediaPlayer2.')) throw Error('non mpris');
        let {DesktopEntry, Identity} = await Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE).newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2'),
            app = DesktopEntry ? `${DesktopEntry}.desktop` : Identity ? Shell.AppSystem.search(Identity)[0]?.[0] : null,
            cat = app ? Shell.AppSystem.get_default().lookup_app(app)?.get_app_info().get_categories().split(';') : null;
        
        // Check if video players should be filtered out
        if(!this.$set.hub.get_boolean(K.AVPL) && cat?.reduce((p, x) => { p[0] &&= x !== 'AudioVideo'; p[1] ||= x === 'Video'; return p; }, [true, false]).some(T.id)) throw Error('non musical');
        
        // This player is valid, add to available list
        this.availablePlayers.set(name, true);
    }

    #selectAndActivatePlayer() {
        const preferred = this.$set.hub.get_string(K.PMPL);
        let playerToActivate = null;
        
        if (preferred && this.availablePlayers.has(preferred)) {
            // Use preferred player if it's available
            playerToActivate = preferred;
        } else if (this.availablePlayers.size > 0) {
            // Auto mode: use first available player
            playerToActivate = this.availablePlayers.keys().next().value;
        }
        
        if (playerToActivate) {
            this.$src.mpris.summon(playerToActivate);
        }
    }

    #selectPreferredPlayer() {
        this.#selectAndActivatePlayer();
    }

    getAvailablePlayers() {
        return Array.from(this.availablePlayers.keys());
    }

    getPreferredPlayer() {
        return this.$set.hub.get_string(K.PMPL);
    }

    setPreferredPlayer(name) {
        this.$set.hub.set_string(K.PMPL, name || '');
    }

    #onPlayerReady(proxy) {
        if(!proxy) return;
        this.#activate(true);
        this.#update(proxy.Metadata);
    }

    async #onNewPlayer(name) {
        // A new player appeared, scan it
        try {
            await this.#scanPlayer(name);
            // If we don't have an active player, or this is the preferred player, activate it
            const preferred = this.$set.hub.get_string(K.PMPL);
            if (!this.$src.mpris.active || (preferred && name === preferred)) {
                this.#selectAndActivatePlayer();
            }
        } catch (e) {
            // Player is not valid (filtered out), ignore
        }
    }

    #onPlayerDisappeared(name) {
        // A player disappeared, remove it from available players
        if (name.startsWith('org.mpris.MediaPlayer2.')) {
            this.availablePlayers.delete(name);
            // Note: No need to trigger rescan here, #onMprisChange will handle
            // switching to another player if the current one disconnected
        }
    }

    #onMprisChange(proxy) {
        if(proxy?.gNameOwner) return;
        // A player disconnected, rescan and reselect (unless already rescanning)
        if (!this._isRescanning) {
            this.#rescanAndSelectPlayer();
        }
    }

    #onPlayerChange(proxy, prop) {
        if(prop.lookup_value('Metadata', null)) this.#update(proxy.Metadata);
        if(prop.lookup_value('PlaybackStatus', null)) this.emit('status', this.status);
    }

    #update(metadata) {
        let {
            'xesam:title': title, 'xesam:artist': artist, 'xesam:asText': lyric,
            'xesam:album': album, 'mpris:length': length = 0,
        } = T.vmap(metadata, v => v.deepUnpack()); // Ref: https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata
        if(!T.str(title) || !title) return;
        this.emit('update', {
            artist: artist?.every?.(T.str) ? artist.flatMap(x => x.split('/')).filter(T.id) : [],
            length: length / 1000, album: T.str(album) ? album : '', lyric: T.str(lyric) ? lyric : null, title,
        });
    }

    async getPosition() { // Ref: https://www.andyholmes.ca/articles/dbus-in-gjs.html
        let pos = await Gio.DBus.session.call(this.$src.mpris.hub.gName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'Get', T.pickle(['org.mpris.MediaPlayer2.Player', 'Position']), null, Gio.DBusCallFlags.NONE, -1, null);
        return pos.recursiveUnpack().at(0) / 1000;
    }

    get status() {
        return this.$src.player.hub?.PlaybackStatus === 'Playing';
    }
}
