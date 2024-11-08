// game/Player.js

const { PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger'); // Importing logger
const { GameError } = require('../utils/error-handler'); // Importing GameError
const ROLES = require('../constants/roles');  // Add this import

const validRoles = [
    ROLES.WEREWOLF,
    ROLES.SEER,
    ROLES.DOCTOR,
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
        this.channel = null; // DM channel
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

        // Send role-specific DM
        let message = `Your role is: **${role}**\n\n`;
        switch (role) {
            case ROLES.WEREWOLF:
                message += 'You are a Werewolf! Each night, you and your fellow werewolves will choose a victim to eliminate.';
                break;
            case ROLES.SEER:
                message += 'You are the Seer! Each night, you can investigate one player to learn if they are a Werewolf.';
                break;
            case ROLES.DOCTOR:
                message += 'You are the Doctor! Each night, you can protect one player from being killed by the Werewolves.';
                break;
            case ROLES.CUPID:
                message += 'You are Cupid! You are on the village team. During Night Zero, you will choose one player to be your lover - choose wisely, as if either of you dies, the other will die of heartbreak.';
                break;
            case ROLES.HUNTER:
                message += 'You are the Hunter! You are on the village team. If you are eliminated (either by werewolves or by village vote), ' +
                          'you can choose one player to take down with you. Use `/action hunter_revenge` when prompted after your death.';
                break;
            case ROLES.VILLAGER:
                message += 'You are a Villager! Work with the village to identify and eliminate the Werewolves.';
                break;
        }

        try {
            await this.sendDM(message);
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
            // Check if player is in game and alive
            if (!this.isAlive) {
                logger.warn(`Attempted to send DM to dead player: ${this.username}`);
                return;
            }

            if (!this.channel) {
                const user = await this.client.users.fetch(this.id);
                if (!user) {
                    logger.error(`Could not fetch user for player: ${this.username}`);
                    return;
                }
                this.channel = await user.createDM();
            }

            await this.channel.send(message);
            logger.info(`DM sent to ${this.username}`);
        } catch (error) {
            logger.error(`Error sending DM to ${this.username}:`, { error });
            throw new GameError('DM Failed', 'Failed to send direct message to player.');
        }
    }

    /**
     * Prompts the player for a response via DM.
     * @param {string} message - The prompt message.
     * @param {Function} filter - The filter function for collecting messages.
     * @param {number} time - Time in milliseconds to wait for a response.
     * @returns {string|null} - The content of the collected message or null if timed out.
     */
    async promptDM(message, filter, time = 600000) { // 10 minutes default
        try {
            await this.sendDM(message);
            const collected = await this.channel.awaitMessages({
                filter,
                max: 1,
                time,
                errors: ['time'],
            });
            return collected.first().content;
        } catch (error) {
            console.error(`Error collecting DM from ${this.username}:`, error);
            return null;
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
