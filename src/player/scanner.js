// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import {isVideoPlayer} from './utils.js';

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
        
        let categories = null;
        if (app) {
            const appInfo = Shell.AppSystem.get_default().lookup_app(app);
            if (appInfo) {
                const categoriesStr = appInfo.get_app_info().get_categories();
                if (categoriesStr) {
                    categories = categoriesStr.split(';').filter(Boolean);
                }
            }
        }
        
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
                // Check if title exists and is a string type
                if (title && title.get_type_string && title.get_type_string() === 's') {
                    const unpacked = title.deepUnpack();
                    // Ensure unpacked value is a non-empty string
                    return (typeof unpacked === 'string' && unpacked.trim()) ? unpacked : null;
                }
            }
        } catch (e) {
            // Ignore errors (player may have disconnected)
        }
        return null;
    }

    /**
     * Verify if a player is still alive and has valid media
     * @param {string} name - Player D-Bus name
     * @returns {Promise<Object>} Status object: {connected, hasMedia}
     */
    async verifyPlayer(name) {
        try {
            const proxy = await Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE)
                .newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
            
            const metadata = proxy.Metadata;
            if (!metadata) {
                return {connected: true, hasMedia: false}; // Connected but no media
            }
            
            // Check if trackid is NoTrack (Chrome's way of saying no media)
            const trackId = metadata['mpris:trackid'];
            if (trackId && trackId.deepUnpack) {
                const trackIdStr = trackId.deepUnpack();
                if (trackIdStr.includes('NoTrack')) {
                    return {connected: true, hasMedia: false}; // Connected but no active track
                }
            }
            
            // Check if title exists and is non-empty
            const title = metadata['xesam:title'];
            if (title && title.get_type_string && title.get_type_string() === 's') {
                const unpacked = title.deepUnpack();
                if (typeof unpacked === 'string' && unpacked.trim()) {
                    return {connected: true, hasMedia: true}; // Has valid media
                }
            }
            
            return {connected: true, hasMedia: false}; // Connected but no valid media
        } catch (e) {
            return {connected: false, hasMedia: false}; // Connection failed
        }
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
