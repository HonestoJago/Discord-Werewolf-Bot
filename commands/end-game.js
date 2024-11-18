// commands/end-game.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError, handleCommandError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const GameStateManager = require('../utils/gameStateManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end-game')
        .setDescription('End the current game'),

    async execute(interaction) {
        try {
            if (!interaction.guild) {
                throw new GameError('Invalid context', 'This command can only be used in a server.');
            }

            const game = interaction.client.games.get(interaction.guildId);
            if (!game) {
                throw new GameError('No game', 'There is no active game to end.');
            }

            // Check if user has permission to end game
            if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
                throw new GameError('Not authorized', 'Only the game creator or authorized users can end the game.');
            }

            await interaction.deferReply();
            await interaction.client.endGame(interaction.guildId);
            await interaction.editReply('Game has been ended and all resources have been cleaned up.');
            
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
