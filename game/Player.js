// game/Player.js

const { PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger'); // Importing logger
const { GameError } = require('../utils/error-handler'); // Importing GameError

const validRoles = [
    'werewolf',
    'seer',
    'doctor',
    'cupid',
    'villager',
    // Add other valid roles as needed
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
    assignRole(role) {
        if (!validRoles.includes(role)) {
            throw new GameError('Invalid Role', `The role "${role}" is not a valid role.`);
        }
        this.role = role;
        logger.info({
            playerId: this.id,
            username: this.username,
            assignedRole: role,
            timestamp: new Date().toISOString()
        }, `Role "${role}" assigned to player ${this.username} (ID: ${this.id}).`);
    }

    /**
     * Sends a direct message to the player.
     * @param {string} message - The message to send.
     */
    async sendDM(message) {
        try {
            if (!this.channel) {
                const user = await this.client.users.fetch(this.id);
                this.channel = await user.createDM();
            }
            await this.channel.send(message);
        } catch (error) {
            console.error(`Error sending DM to ${this.username}:`, error);
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
