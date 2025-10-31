// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Pango from 'gi://Pango';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as F from '../fubar.js';
import {formatPlayerName, formatPlayerDisplay} from './utils.js';

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
        
        // Add hint at the top
        const hintItem = new PopupMenu.PopupMenuItem(_('Manual selection enables lyrics'));
        hintItem.setSensitive(false);
        this._enableEllipsis(hintItem);
        item.menu.addMenuItem(hintItem);
        
        // Add separator after hint
        item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add "Auto" option
        const autoItem = new PopupMenu.PopupMenuItem(_('Auto'));
        this._enableEllipsis(autoItem);
        autoItem.connect('activate', () => {
            this.mpris.setPreferredPlayer('');
            this.updateMenuLabel(item);
        });
        item.menu.addMenuItem(autoItem);
        
        // Add "None" option
        const noneItem = new PopupMenu.PopupMenuItem(_('None'));
        this._enableEllipsis(noneItem);
        noneItem.connect('activate', () => {
            this.mpris.setPreferredPlayer('none');
            this.updateMenuLabel(item);
        });
        item.menu.addMenuItem(noneItem);
        
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
            'none': _('None'),
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
        
        // Clear existing items except the first four (hint, separator, Auto, None)
        const items = item.menu._getMenuItems();
        for (let i = items.length - 1; i >= 4; i--) {
            items[i].destroy();
        }
        
        // Set ornament for Auto and None items (indices 2 and 3)
        items[2].setOrnament(!preferred ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        items[3].setOrnament(preferred === 'none' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        
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
            const displayText = formatPlayerDisplay(name, info);
            const playerItem = new PopupMenu.PopupMenuItem(displayText);
            
            // Enable ellipsis for long player names/titles
            this._enableEllipsis(playerItem);
            
            playerItem.connect('activate', () => {
                // Toggle: if clicking already selected player, deselect it (set to 'none')
                if (name === preferred) {
                    this.mpris.setPreferredPlayer('none', false);
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
