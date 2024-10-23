// commands/start.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const PHASES = require('../constants/phases');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Start the Werewolf game. Only the game creator can use this command.'),
    async execute(interaction, gameInstance) {
        try {
            // Check if the user is the game creator
            if (interaction.user.id !== gameInstance.gameCreatorId) {
                throw new GameError('Not authorized', 'Only the game creator can start the game.');
            }

            await gameInstance.startGame();
            await interaction.reply({ content: 'The game has started!', ephemeral: true });
        } catch (error) {
            logger.error({ error }, 'Error executing /start command');
            await interaction.reply({ content: error.userMessage || 'An error occurred while starting the game.', ephemeral: true });
        }
    },
};

