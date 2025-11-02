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
        const selected = this.selector.selectPlayer(this.availablePlayers, preferred, currentPlayer);
        
        if (selected) {
            this.$src.mpris.summon(selected);
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

/**
 * Format player name for display
 * @param {string} name - Full D-Bus name (e.g., org.mpris.MediaPlayer2.chromium.instance123)
 * @returns {string} - Formatted name (e.g., chromium)
 */
export function formatPlayerName(name) {
    const match = name.match(/org\.mpris\.MediaPlayer2\.([^.]+)/);
    return match ? match[1] : name;
}

/**
 * Check if the app categories indicate a video player
 * @param {string[]|null} categories - App categories
 * @param {string} playerName - Player name (e.g., 'chromium', 'firefox')
 * @returns {boolean} - True if it's a video player (contains Video category or is a browser)
 */
export function isVideoPlayer(categories, playerName = '') {
    // Whitelist: known music players that should never be treated as video players
    const musicPlayers = ['splayer', 'yesplaymusic'];
    const lowerName = playerName.toLowerCase();
    if (musicPlayers.some(music => lowerName.includes(music))) {
        return false;
    }
    
    if (!categories) {
        // Browsers can play videos, treat them as video players
        const browsers = ['chromium', 'chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'epiphany'];
        return browsers.some(browser => lowerName.includes(browser));
    }
    
    // Check for Video category
    if (categories.includes('Video')) {
        return true;
    }
    
    // Browsers with WebBrowser category are treated as video players
    if (categories.includes('WebBrowser')) {
        return true;
    }
    
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
                const titleVariant = metadata['xesam:title'];
                const lyricsVariant = metadata['xesam:asText'];
                
                let title = null;
                let hasLyrics = false;
                
                // Check if title exists and is a string type
                if (titleVariant && titleVariant.get_type_string && titleVariant.get_type_string() === 's') {
                    const unpacked = titleVariant.deepUnpack();
                    title = (typeof unpacked === 'string' && unpacked.trim()) ? unpacked : null;
                }
                
                // Check if lyrics exist
                if (lyricsVariant && lyricsVariant.get_type_string && lyricsVariant.get_type_string() === 's') {
                    const lyricsText = lyricsVariant.deepUnpack();
                    hasLyrics = typeof lyricsText === 'string' && lyricsText.trim().length > 0;
                }
                
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
     * @param {string|null} currentPlayer - Currently active player
     * @returns {string|null} Selected player name or null
     */
    selectPlayer(availablePlayers, preferredPlayer, currentPlayer = null) {
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
        const item = new PopupMenu.PopupSubMenuMenuItem(_('MPRIS Player'));
        this._enableEllipsis(item);
        
        // Add "Auto" option
        const autoItem = new PopupMenu.PopupMenuItem(_('Auto'));
        this._enableEllipsis(autoItem);
        autoItem.connect('activate', () => {
            this.mpris.setPreferredPlayer('');
            this.updateMenuLabel(item);
        });
        item.menu.addMenuItem(autoItem);
        
        // Update menu when it opens
        item.menu.connect('open-state-changed', (menu, open) => {
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
        const labels = {
            '': _('Auto'),
        };
        const label = labels[preferred] ?? formatPlayerName(preferred);
        item.label.set_text(`${_('MPRIS Player')}: ${label}`);
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
        
        // Set ornament for Auto item (index 0)
        items[0].setOrnament(!preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        
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
            const displayText = info.currentTitle || formatPlayerName(name);
            
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
}
