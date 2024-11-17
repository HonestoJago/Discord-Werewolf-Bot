// game/Player.js

const { PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger'); // Importing logger
const { GameError } = require('../utils/error-handler'); // Importing GameError
const ROLES = require('../constants/roles');  // Add this import
const { createRoleCard } = require('../utils/embedCreator');

const validRoles = [
    ROLES.WEREWOLF,
    ROLES.SEER,
    ROLES.BODYGUARD,
    ROLES.CUPID,
    ROLES.HUNTER,
    ROLES.VILLAGER
];

class Player {
    constructor(id, username, client) {
        this.id = id;
        this.username = username;
        this.client = client; // Discord client
        this.role = null;
        this.isAlive = true;
        this.isProtected = false;
    }

    /**
     * Assigns a role to the player.
     * @param {string} role - The role to assign.
     * @throws {GameError} Throws an error if the role is invalid.
     */
    async assignRole(role) {
        if (!validRoles.includes(role)) {
            throw new GameError('Invalid Role', `The role "${role}" is not a valid role.`);
        }
        this.role = role;

        try {
            // Create and send role card
            const roleCard = createRoleCard(role);
            
            // Add game-specific information based on role
            let additionalInfo = '';
            switch (role) {
                case ROLES.WEREWOLF:
                    additionalInfo = '\n\nUse `/action attack` during night phases to eliminate players.';
                    break;
                case ROLES.SEER:
                    additionalInfo = '\n\nUse `/action investigate` during night phases to learn about other players.';
                    break;
                case ROLES.BODYGUARD:
                    additionalInfo = '\n\nUse `/action protect` during night phases to guard players.';
                    break;
                case ROLES.CUPID:
                    additionalInfo = '\n\nUse `/action choose_lovers` during Night Zero to select your lover.';
                    break;
                case ROLES.HUNTER:
                    additionalInfo = '\n\nWhen eliminated, use `/action choose_target` to take revenge.';
                    break;
                case ROLES.VILLAGER:
                    additionalInfo = '\n\nStay vigilant and vote wisely during day phases!';
                    break;
            }

            // Send the role card and additional information
            await this.sendDM({ 
                embeds: [roleCard],
                content: `You have been assigned a role!${additionalInfo}`
            });

            logger.info('Role assigned and DM sent', {
                playerId: this.id,
                username: this.username,
                role: role
            });
        } catch (error) {
            logger.error('Error sending role DM', { error });
            throw new GameError('DM Failed', 'Failed to send role information. Please make sure you can receive DMs from the bot.');
        }
    }

    /**
     * Sends a direct message to the player.
     * @param {string} message - The message to send.
     */
    async sendDM(message) {
        try {
            const user = await this.client.users.fetch(this.id);
            if (!user) {
                logger.error('Could not find user to send DM', { 
                    userId: this.id, 
                    username: this.username 
                });
                return;
            }

            const dmChannel = await user.createDM();
            await dmChannel.send(message);
            logger.info('DM sent to player', { 
                username: this.username,
                hasEmbed: !!message.embeds,
                hasComponents: !!message.components
            });
        } catch (error) {
            logger.error('Error sending DM to player', { 
                error,
                userId: this.id,
                username: this.username
            });
            // Don't throw - just log the error
            // This prevents a failed DM from breaking game flow
        }
    }

    /**
     * Prompts the player for a response via DM.
     * @param {string} message - The prompt message.
     * @param {Function} filter - The filter function for collecting messages.
     * @param {number} time - Time in milliseconds to wait for a response.
     * @returns {string|null} - The content of the collected message or null if timed out.
     */
    async promptDM(message, filter, time = 600000) {
        try {
            await this.sendDM(message);
            
            const collected = await this.channel.awaitMessages({
                filter: filter || (() => true),
                max: 1,
                time,
                errors: ['time']
            });

            const firstMessage = collected.first();
            if (!firstMessage) {
                throw new GameError('No response', 'No response received.');
            }

            return firstMessage.content;
        } catch (error) {
            logger.error(`Error collecting DM from ${this.username}:`, error);
            if (error.message === 'time') {
                return null;  // Expected timeout
            }
            throw error;  // Propagate unexpected errors
        }
    }

    /**
     * Resets the player's state for a new game.
     */
    reset() {
        this.role = null;
        this.isAlive = true;
        this.isProtected = false;
    }
}

module.exports = Player;
