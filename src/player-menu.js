// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Pango from 'gi://Pango';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as F from './fubar.js';
import {formatPlayerName, formatPlayerDisplay} from './player-utils.js';

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
     * Generate the player submenu item
     * @returns {PopupMenu.PopupSubMenuMenuItem} The submenu item
     */
    buildMenu() {
        const item = new PopupMenu.PopupSubMenuMenuItem(_('MPRIS Player'));
        
        // Enable ellipsis for the main label
        item.label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        
        // Add hint at the top
        const hintItem = new PopupMenu.PopupMenuItem(_('Manual selection enables lyrics'));
        hintItem.setSensitive(false);
        item.menu.addMenuItem(hintItem);
        
        // Add separator after hint
        item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add "Auto" option
        const autoItem = new PopupMenu.PopupMenuItem(_('Auto'));
        autoItem.connect('activate', () => {
            this.mpris.setPreferredPlayer('');
            this.updateMenuLabel(item);
        });
        item.menu.addMenuItem(autoItem);
        
        // Add "None" option
        const noneItem = new PopupMenu.PopupMenuItem(_('None'));
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
        // Set submenu max width slightly smaller than parent to account for padding
        const parentWidth = item.get_parent()?.get_parent()?.box?.get_width();
        if (parentWidth > 0) {
            // Subtract padding/margin to prevent expanding parent
            const submenuMaxWidth = parentWidth - 20;
            item.menu.box.set_style(`max-width: ${submenuMaxWidth}px;`);
        }
        
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
        
        // Refresh all player titles first, then add menu items
        await Promise.all(players.map(name => this.mpris.refreshPlayerTitle(name)));
        
        // Now add player items with updated titles
        players.forEach((name) => {
            const info = this.mpris.getPlayerInfo(name);
            const displayText = formatPlayerDisplay(name, info);
            const playerItem = new PopupMenu.PopupMenuItem(displayText);
            
            // Enable ellipsis for long player names/titles
            playerItem.label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
            
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
