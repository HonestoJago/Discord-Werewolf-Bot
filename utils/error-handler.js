// utils/error-handler.js

const logger = require('./logger');

// Custom Error class for game-related errors
class GameError extends Error {
    constructor(message, userMessage) {
        super(message);
        this.name = 'GameError';
        this.userMessage = userMessage;
    }
}

/**
 * Handles errors thrown during command execution.
 * @param {Interaction} interaction - The Discord interaction that triggered the command.
 * @param {Error} error - The error that was thrown.
 */
async function handleCommandError(interaction, error) {
    const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    if (error instanceof GameError) {
        logger.warn({
            errorId,
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guild?.id,
            error: error.message
        }, 'Game error in command execution');

        const userMessage = error.userMessage || `An error occurred. Error ID: ${errorId}`;
        await safeReply(interaction, userMessage);
    } else {
        logger.error({
            errorId,
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guild?.id,
            error: error.stack
        }, 'Unexpected error in command execution');

        await safeReply(interaction, `An unexpected error occurred. Error ID: ${errorId}`);
    }
}

/**
 * Safely replies to an interaction, handling cases where the interaction is already replied to or deferred.
 * @param {Interaction} interaction - The Discord interaction to reply to.
 * @param {string} content - The message content to send.
 */
async function safeReply(interaction, content) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content, ephemeral: true });
        } else {
            await interaction.reply({ content, ephemeral: true });
        }
    } catch (replyError) {
        logger.error({ replyError }, 'Error while replying to interaction');
    }
}

module.exports = { handleCommandError, GameError };

