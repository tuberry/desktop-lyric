// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import {isVideoPlayer} from './player-utils.js';

const MPRIS_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2');
const PLAYER_IFACE = FileUtils.loadInterfaceXML('org.mpris.MediaPlayer2.Player');

/**
 * PlayerScanner - Responsible for scanning and discovering MPRIS players
 */
export class PlayerScanner {
    constructor(settings) {
        this.settings = settings;
        this.playerProxies = new Map();
    }

    /**
     * Scan a single player and return its info
     * @param {string} name - D-Bus name
     * @param {Function} onStatusChanged - Callback for status changes
     * @returns {Promise<Object>} Player info object
     * @throws {Error} If player is invalid or filtered out
     */
    async scanPlayer(name, onStatusChanged) {
        if (!name.startsWith('org.mpris.MediaPlayer2.')) {
            throw Error('non mpris');
        }
        
        // Get player metadata
        const {DesktopEntry, Identity} = await Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE)
            .newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
        
        const app = DesktopEntry 
            ? `${DesktopEntry}.desktop` 
            : Identity ? Shell.AppSystem.search(Identity)[0]?.[0] : null;
        
        const categories = app 
            ? Shell.AppSystem.get_default().lookup_app(app)?.get_app_info().get_categories().split(';') 
            : null;
        
        // Extract player name from D-Bus name
        const playerName = name.match(/org\.mpris\.MediaPlayer2\.([^.]+)/)?.[1] || '';
        
        // Determine if this is a video player
        const isVideo = isVideoPlayer(categories, playerName);
        
        // Check if video players should be filtered out
        const allowVideoPlayers = this.settings.hub.get_boolean('allow-video-players');
        if (!allowVideoPlayers && isVideo) {
            throw Error('non musical');
        }
        
        // Create proxy to monitor this player's status
        let playbackStatus = 'Stopped';
        try {
            const proxy = await Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE)
                .newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
            
            playbackStatus = proxy.PlaybackStatus || 'Stopped';
            
            // Monitor playback status changes
            const signalId = proxy.connect('g-properties-changed', (proxy, changed) => {
                if (changed.lookup_value('PlaybackStatus', null)) {
                    onStatusChanged(name, proxy.PlaybackStatus);
                }
            });
            
            // Store proxy for cleanup later
            this.playerProxies.set(name, {proxy, signalId});
        } catch (e) {
            // Failed to get status, default to Stopped
        }
        
        // Return player info (title will be fetched lazily when menu opens)
        return {
            isVideo,
            currentTitle: null,
            playbackStatus,
        };
    }

    /**
     * Refresh the current playing title for a player
     * @param {string} name - Player D-Bus name
     * @returns {Promise<string|null>} Current title or null
     */
    async refreshPlayerTitle(name) {
        try {
            const proxy = await Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE)
                .newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
            
            const metadata = proxy.Metadata;
            if (metadata) {
                const title = metadata['xesam:title'];
                if (title && title.get_type_string() === 's') {
                    return title.deepUnpack();
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return null;
    }

    /**
     * Clean up all player proxies
     */
    cleanup() {
        for (const [name, {proxy, signalId}] of this.playerProxies.entries()) {
            if (signalId) {
                proxy.disconnect(signalId);
            }
        }
        this.playerProxies.clear();
    }

    /**
     * Clean up a specific player proxy
     * @param {string} name - Player D-Bus name
     */
    cleanupPlayer(name) {
        const proxyInfo = this.playerProxies.get(name);
        if (proxyInfo) {
            if (proxyInfo.signalId) {
                proxyInfo.proxy.disconnect(proxyInfo.signalId);
            }
            this.playerProxies.delete(name);
        }
    }
}
