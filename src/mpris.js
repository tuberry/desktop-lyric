// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

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
        
        // Listen for setting changes - use F.connect for automatic cleanup on destroy
        F.connect(this, this.$set.hub, `changed::${K.AVPL}`, () => this.onSettingChanged());
        F.connect(this, this.$set.hub, `changed::${K.PMPL}`, () => this.onPreferredPlayerChanged());
    }

    buildSources(playerIface) {
        let dbus = new F.DBusProxy('org.freedesktop.DBus', '/org/freedesktop/DBus', 
            x => x && this.$src.rescanTimer.revive(() => this.rescanAndSelectPlayer()), 
            null,
            [['NameOwnerChanged', (_p, _s, [name, oldOwner, newOwner]) => { 
                // Handle both disappearance and appearance independently
                // Reference: https://github.com/GNOME/gnome-shell/blob/9d904a804e73c97a1ecde406f395cd77a53f10e7/js/ui/mpris.js#L238
                if (oldOwner) this.onPlayerDisappeared(name);
                if (newOwner) this.onNewPlayer(name);
            }]]),
            mpris = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', 
                y => y && this.$src.player.revive(y.gName),
                [['notify::g-name-owner', (...xs) => this.onMprisChange(...xs)]], 
                null, MPRIS_IFACE)),
            player = new F.Source(x => new F.DBusProxy(x, '/org/mpris/MediaPlayer2', 
                (...xs) => this.onPlayerReady(...xs),
                [['g-properties-changed', (...xs) => this.onPlayerChange(...xs)]], 
                [['Seeked', (_p, _s, [pos]) => this.emit('seeked', pos / 1000)]], 
                playerIface)),
            rescanTimer = F.Source.newTimer(() => [() => {}, 0]); // Timer for deferred rescanning
        this.$src = F.Source.tie({dbus, mpris, player, rescanTimer}, this);
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
        const preferred = this.getPreferredPlayer();
        
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

    cleanupInvalidPreferredPlayer() {
        const preferred = this.getPreferredPlayer();
        // If preferred player doesn't exist anymore (e.g., after reboot), reset to auto
        if (preferred && !this.availablePlayers.has(preferred)) {
            this.setPreferredPlayer(''); // Reset to auto mode
            this.manuallySelected = false;
            return true; // Was cleaned up
        }
        return false; // No cleanup needed
    }

    selectAndActivatePlayer() {
        // Clean up invalid preferred player first
        this.cleanupInvalidPreferredPlayer();
        
        const preferred = this.getPreferredPlayer();
        const currentPlayer = this.$src.mpris.hub?.gName;
        const selected = this.selector.selectPlayer(this.availablePlayers, preferred);
        
        if (selected) {
            // Use revive if player already exists, summon only if it doesn't
            if (currentPlayer && this.$src.mpris.active) {
                this.$src.mpris.revive(selected);
            } else {
                this.$src.mpris.summon(selected);
            }
        } else {
            this.$src.mpris.dispel();
            this.$src.player.dispel();
            this.activate(this.availablePlayers.size > 0);
            // Only clear manual selection if user chose auto mode
            if (preferred === '') {
                this.manuallySelected = false;
            }
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
        const {title, hasLyrics} = await this.scanner.refreshPlayerMetadata(name);
        const info = this.availablePlayers.get(name);
        if (info) {
            info.currentTitle = title;
            info.hasLyrics = hasLyrics;
        }
    }

    async verifyAndRefreshPlayer(name) {
        // Verify if player is still alive and has valid media
        const {connected, hasMedia} = await this.scanner.verifyPlayer(name);
        
        if (!connected) {
            // Player is disconnected, remove it
            this.availablePlayers.delete(name);
            this.scanner.cleanupPlayer(name);
            return false;
        }
        
        const info = this.availablePlayers.get(name);
        if (!info) return false;
        
        if (hasMedia) {
            // Player has media, refresh its title
            await this.refreshPlayerTitle(name);
            return true; // Show in menu
        } else {
            // Player is connected but has no media (e.g., tab closed)
            // Keep it in the list but clear the title and don't show in menu
            info.currentTitle = null;
            return false; // Don't show in menu
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
        this.manuallySelected = isManual && name;
    }

    onPlayerReady(proxy) {
        if (!proxy) return;
        this.activate(true);
        this.update(proxy.Metadata);
    }

    async onNewPlayer(name) {
        try {
            await this.scanPlayer(name);
            
            const preferred = this.getPreferredPlayer();
            const newPlayerInfo = this.availablePlayers.get(name);
            const currentPlayer = this.$src.mpris.hub?.gName;
            
            if (this.selector.shouldActivateNewPlayer(
                name, newPlayerInfo, currentPlayer, preferred, this.$src.mpris.active, this.availablePlayers
            )) {
                // Use revive if player already exists, summon only if it doesn't
                if (currentPlayer && this.$src.mpris.active) {
                    this.$src.mpris.revive(name);
                } else {
                    this.$src.mpris.summon(name);
                }
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
        
        const preferred = this.getPreferredPlayer();
        if (!preferred && this.$src.mpris.active) {
            // Auto mode: always re-evaluate when any player status changes
            // This ensures we always have the best player selected
            this.selectAndActivatePlayer();
        }
    }

    onPlayerChange(proxy, prop) {
        if (prop.lookup_value('Metadata', null)) this.update(proxy.Metadata);
        if (prop.lookup_value('PlaybackStatus', null)) {
            this.emit('status', this.status);
        }
    }

    update(metadata) {
        // Unpack metadata following GNOME Shell's approach
        const meta = {};
        for (const prop in metadata)
            meta[prop] = metadata[prop].deepUnpack();
        
        // Validate title (required)
        const title = meta['xesam:title'];
        if (!T.str(title) || !title) return;
        
        // Validate artist (should be array of strings)
        let artist = meta['xesam:artist'];
        if (!Array.isArray(artist) || !artist.every(T.str)) {
            artist = [];
        }
        
        // Validate album (should be string)
        const album = T.str(meta['xesam:album']) ? meta['xesam:album'] : '';
        
        // Validate lyrics (should be string)
        const lyric = T.str(meta['xesam:asText']) ? meta['xesam:asText'] : null;
        
        // Validate length (should be number)
        const length = (meta['mpris:length'] || 0) / 1000;
        
        this.emit('update', {
            artist: artist.flatMap(x => x.split('/')).filter(T.id),
            length, 
            album, 
            lyric, 
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

/**
 * Format player name for display
 * @param {string} name - Full D-Bus name (e.g., org.mpris.MediaPlayer2.chromium.instance123)
 * @param {Object|null} appInfo - Optional app info object to get display name
 * @returns {string} - Formatted name (e.g., "Google Chrome" or "chromium")
 */
export function formatPlayerName(name, appInfo = null) {
    // Prefer app display name if available
    if (appInfo) {
        const displayName = appInfo.get_name();
        if (displayName) return displayName;
    }
    
    // Fallback: Extract the app name after org.mpris.MediaPlayer2.
    // Handle reverse domain names (e.g., io.bassi.Amberol, com.github.neithern.g4music)
    const prefix = 'org.mpris.MediaPlayer2.';
    if (!name.startsWith(prefix)) return name;
    
    // Remove prefix and instance suffix (e.g., .instance123)
    let appPart = name.slice(prefix.length).replace(/\.instance\d+$/, '');
    
    // If it looks like a reverse domain name (contains dots), use the last segment
    const segments = appPart.split('.');
    return segments[segments.length - 1];
}

/**
 * Check if the app categories indicate a video player
 * Only checks Categories, not app names (more reliable)
 * @param {string[]|null} categories - App categories
 * @returns {boolean} - True if it's a video player
 */
export function isVideoPlayer(categories) {
    if (!categories) {
        return false;
    }
    
    // Video or WebBrowser category indicates video player
    if (categories.includes('Video') || categories.includes('WebBrowser')) {
        return true;
    }
    
    // Audio or AudioVideo category indicates music player (e.g., SPlayer, yesplaymusic)
    if (categories.includes('Audio') || categories.includes('AudioVideo')) {
        return false;
    }
    
    // Default: not a video player
    return false;
}

/**
 * Parse playback status priority for auto-selection
 * @param {string} status - Playback status (Playing, Paused, Stopped)
 * @returns {number} - Priority value (higher is better)
 */
export function getPlaybackPriority(status) {
    const priorities = {
        'Playing': 3,
        'Paused': 2,
        'Stopped': 1,
    };
    return priorities[status] || 0;
}

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
        let appInfo = null;
        if (app) {
            appInfo = Shell.AppSystem.get_default().lookup_app(app);
            if (appInfo) {
                const categoriesStr = appInfo.get_app_info().get_categories();
                if (categoriesStr) {
                    categories = categoriesStr.split(';').filter(Boolean);
                }
            }
        }
        
        // Determine if this is a video player
        const isVideo = isVideoPlayer(categories);
        
        // Check if video players should be filtered out
        const allowVideoPlayers = this.settings.hub.get_boolean(K.AVPL);
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
            
            // Store proxy and signalId for manual cleanup
            this.playerProxies.set(name, {proxy, signalId});
        } catch (e) {
            // Failed to get status, default to Stopped
        }
        
        // Return player info (title and lyrics will be fetched lazily when menu opens)
        return {
            isVideo,
            currentTitle: null,
            playbackStatus,
            hasLyrics: false,
            appInfo, // Store app info for icon
        };
    }

    /**
     * Refresh the current playing title and lyrics for a player
     * @param {string} name - Player D-Bus name
     * @returns {Promise<Object>} {title: string|null, hasLyrics: boolean}
     */
    async refreshPlayerMetadata(name) {
        try {
            const proxy = await Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE)
                .newAsync(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
            
            const metadata = proxy.Metadata;
            if (metadata) {
                // Unpack metadata following GNOME Shell's approach
                const meta = {};
                for (const prop in metadata)
                    meta[prop] = metadata[prop].deepUnpack();
                
                // Validate title
                const title = (T.str(meta['xesam:title']) && meta['xesam:title'].trim()) 
                    ? meta['xesam:title'] : null;
                
                // Check if lyrics exist
                const hasLyrics = T.str(meta['xesam:asText']) && meta['xesam:asText'].trim().length > 0;
                
                return {title, hasLyrics};
            }
        } catch (e) {
            // Ignore errors (player may have disconnected)
        }
        return {title: null, hasLyrics: false};
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

/**
 * PlayerSelector - Responsible for player selection strategy
 */
export class PlayerSelector {
    /**
     * Select the best player from available players
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @param {string} preferredPlayer - User's preferred player setting
     * @returns {string|null} Selected player name or null
     */
    selectPlayer(availablePlayers, preferredPlayer) {
        const hasPlayers = availablePlayers.size > 0;
        
        // If user explicitly selected a player
        if (preferredPlayer && availablePlayers.has(preferredPlayer)) {
            return preferredPlayer;
        }
        
        // Auto mode: smart selection based on playback status
        if (!preferredPlayer && hasPlayers) {
            return this.autoSelectPlayer(availablePlayers);
        }
        
        return null;
    }

    /**
     * Auto-select best player based on playback status
     * Priority: Music Playing > Video Playing > Music Paused > Video Paused > Music Stopped > Video Stopped
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @returns {string|null} Selected player name
     */
    autoSelectPlayer(availablePlayers) {
        const players = Array.from(availablePlayers.entries());
        
        // Separate music and video players
        const musicPlayers = players.filter(([_, info]) => !info.isVideo);
        const videoPlayers = players.filter(([_, info]) => info.isVideo);
        
        // Find best of each type
        const bestMusic = this._findBestPlayer(musicPlayers);
        const bestVideo = this._findBestPlayer(videoPlayers);
        
        // No players at all
        if (!bestMusic && !bestVideo) return null;
        
        // Only one type available
        if (!bestMusic) return bestVideo;
        if (!bestVideo) return bestMusic;
        
        // Both available: compare priorities with music boost
        // Music boost: 0.5 ensures Music Playing > Video Playing > Music Paused
        const musicInfo = availablePlayers.get(bestMusic);
        const videoInfo = availablePlayers.get(bestVideo);
        const musicPriority = getPlaybackPriority(musicInfo.playbackStatus) + 0.5;
        const videoPriority = getPlaybackPriority(videoInfo.playbackStatus);
        
        return musicPriority >= videoPriority ? bestMusic : bestVideo;
    }

    /**
     * Find best player from a list based on playback status and lyrics
     * Priority: has lyrics > playback status
     * @param {Array} players - Array of [name, info] tuples
     * @returns {string|null} Best player name
     */
    _findBestPlayer(players) {
        if (players.length === 0) return null;
        
        let bestPlayer = null;
        let bestPriority = 0;
        
        for (const [name, info] of players) {
            // Base priority from playback status (Playing=3, Paused=2, Stopped=1)
            let priority = getPlaybackPriority(info.playbackStatus);
            
            // Boost priority if player has lyrics
            // Add 0.3 so: Playing+Lyrics > Playing > Paused+Lyrics > Paused
            if (info.hasLyrics) {
                priority += 0.3;
            }
            
            if (priority > bestPriority) {
                bestPriority = priority;
                bestPlayer = name;
            }
        }
        
        // If no player with priority > 0, return first player
        return bestPlayer || players[0][0];
    }

    /**
     * Check if we should auto-switch away from current player
     * @param {string} currentPlayer - Current player name
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @returns {boolean} True if should switch
     */
    shouldAutoSwitch(currentPlayer, availablePlayers) {
        const currentInfo = availablePlayers.get(currentPlayer);
        
        // If current player is playing, don't switch
        if (currentInfo?.playbackStatus === 'Playing') {
            return false;
        }
        
        // Check if any other player is playing
        return Array.from(availablePlayers.entries())
            .some(([name, info]) => name !== currentPlayer && info.playbackStatus === 'Playing');
    }

    /**
     * Determine if a new player should be activated immediately
     * @param {string} newPlayerName - New player that appeared
     * @param {Object} newPlayerInfo - New player info
     * @param {string|null} currentPlayer - Currently active player
     * @param {string} preferredPlayer - User's preferred player
     * @param {boolean} hasActivePlayer - Whether there's an active player
     * @param {Map<string, Object>} availablePlayers - All available players
     * @returns {boolean} True if should activate immediately
     */
    shouldActivateNewPlayer(newPlayerName, newPlayerInfo, currentPlayer, preferredPlayer, hasActivePlayer, availablePlayers) {
        // No active player, activate this one
        if (!hasActivePlayer) {
            return true;
        }
        
        // This is the preferred player, activate it
        if (preferredPlayer && newPlayerName === preferredPlayer) {
            return true;
        }
        
        // Auto mode: activate if new player is better than current
        if (!preferredPlayer && newPlayerInfo?.playbackStatus === 'Playing') {
            // If new player is music, always activate (music > video)
            if (!newPlayerInfo.isVideo) {
                return true;
            }
            
            // If new player is video, only activate if current is not music
            if (currentPlayer) {
                const currentInfo = availablePlayers?.get(currentPlayer);
                // Don't switch to video if current is music
                if (currentInfo && !currentInfo.isVideo) {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
}

const {_} = F;

/**
 * PlayerMenu - Manages the MPRIS player selection submenu
 */
export class PlayerMenu {
    constructor(mprisManager) {
        this.mpris = mprisManager;
        this.menuItem = null;
        this.menuSignalId = null; // Track signal ID for cleanup
        this.autoItem = null; // Track auto item for cleanup
    }

    /**
     * Enable ellipsis for menu item label
     * @param {Object} menuItem - Menu item with label
     */
    _enableEllipsis(menuItem) {
        menuItem.label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
    }

    /**
     * Generate the player submenu item
     * @returns {PopupMenu.PopupSubMenuMenuItem} The submenu item
     */
    buildMenu() {
        const item = new PopupMenu.PopupSubMenuMenuItem(_('Media Source'));
        this._enableEllipsis(item);
        
        // Add "Auto" option
        this.autoItem = new PopupMenu.PopupMenuItem(_('Auto'));
        this._enableEllipsis(this.autoItem);
        this.autoItem.connect('activate', () => {
            this.mpris.setPreferredPlayer('');
            this.updateMenuLabel(item);
        });
        item.menu.addMenuItem(this.autoItem);
        
        // Update menu when it opens - store signal ID for cleanup
        this.menuSignalId = item.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this.onMenuOpened(item);
            }
        });
        
        // Initial label update
        this.updateMenuLabel(item);
        
        this.menuItem = item;
        return item;
    }

    /**
     * Handle menu opened event
     * @param {PopupMenu.PopupSubMenuMenuItem} item - The menu item
     */
    onMenuOpened(item) {
        // Update player menu items
        this.updatePlayerMenuItems(item);
    }

    /**
     * Update the menu label with current selection
     * @param {PopupMenu.PopupSubMenuMenuItem} item - The menu item
     */
    updateMenuLabel(item) {
        const preferred = this.mpris.getPreferredPlayer();
        
        // Special labels for known values
        const label = preferred === '' ? _('Auto') : 
                      formatPlayerName(preferred, this.mpris.getPlayerInfo(preferred)?.appInfo);
        
        item.label.set_text(`${_('Media Source')}: ${label}`);
    }

    /**
     * Update the player menu items list
     * @param {PopupMenu.PopupSubMenuMenuItem} item - The menu item
     */
    async updatePlayerMenuItems(item) {
        const players = this.mpris.getAvailablePlayers();
        const preferred = this.mpris.getPreferredPlayer();
        
        // Clear existing items except the first one (Auto)
        const items = item.menu._getMenuItems();
        for (let i = items.length - 1; i >= 1; i--) {
            items[i].destroy();
        }
        
        // Set ornament for Auto item using saved reference
        if (this.autoItem) {
            this.autoItem.setOrnament(!preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        }
        
        // Verify and refresh all player titles, filter out dead players
        const verificationResults = await Promise.all(
            players.map(name => this.mpris.verifyAndRefreshPlayer(name))
        );
        
        // Filter out players that failed verification
        const validPlayers = players.filter((name, index) => verificationResults[index]);
        
        // After validation, clean up invalid preferred player if needed
        this.mpris.cleanupInvalidPreferredPlayer();
        
        // Now add player items with updated titles
        validPlayers.forEach((name) => {
            const info = this.mpris.getPlayerInfo(name);
            
            // Get display text (only title, no app name or badges)
            const displayText = info.currentTitle || formatPlayerName(name, info?.appInfo);
            
            // Create menu item (ornament will be on left by default)
            const playerItem = new PopupMenu.PopupMenuItem(displayText);
            
            // Add app icon before the label (after ornament)
            const icon = info.appInfo ? info.appInfo.get_icon() : null;
            if (icon) {
                const iconWidget = new St.Icon({
                    gicon: icon,
                    style_class: 'popup-menu-icon',
                });
                // Insert icon before label
                playerItem.insert_child_at_index(iconWidget, 1);
            }
            
            // Enable ellipsis for long titles
            this._enableEllipsis(playerItem);
            
            playerItem.connect('activate', () => {
                // Toggle: if clicking already selected player, switch back to Auto
                if (name === preferred) {
                    this.mpris.setPreferredPlayer('', false);
                } else {
                    this.mpris.setPreferredPlayer(name, true); // Mark as manual selection
                }
                this.updateMenuLabel(item);
            });
            
            playerItem.setOrnament(name === preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
            item.menu.addMenuItem(playerItem);
        });
    }

    /**
     * Refresh the menu label (called externally when player changes)
     */
    refresh() {
        if (this.menuItem) {
            this.updateMenuLabel(this.menuItem);
        }
    }

    /**
     * Cleanup - disconnect signals and destroy menu items
     */
    destroy() {
        if (this.menuItem && this.menuSignalId) {
            this.menuItem.menu.disconnect(this.menuSignalId);
            this.menuSignalId = null;
        }
        // Note: autoItem and playerItems are destroyed when menuItem is destroyed,
        // as they are children of menuItem.menu. No need to manually destroy them.
        this.autoItem = null;
        this.menuItem = null;
    }
}
