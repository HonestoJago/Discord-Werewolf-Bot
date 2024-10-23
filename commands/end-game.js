// commands/end-game.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end-game')
        .setDescription('Ends the current Werewolf game.'),
    async execute(interaction, gameInstance) {
        try {
            // Check if a game exists
            if (!gameInstance) {
                throw new GameError('No Active Game', 'There is no active game to end.');
            }

            // Optionally, check if the user is authorized to end the game
            if (interaction.user.id !== gameInstance.gameCreatorId) {
                throw new GameError('Unauthorized', 'Only the game creator can end the game.');
            }

            await gameInstance.shutdownGame();
            
            // Get the client instance from the interaction
            const client = interaction.client;
            client.endGame(); // Reset the game instance
            
            await interaction.reply({ content: 'The game has been successfully ended and cleaned up.', ephemeral: true });
            logger.info('Game ended by user', { 
                userId: interaction.user.id, 
                guildId: interaction.guildId, 
                timestamp: new Date().toISOString() 
            });
        } catch (error) {
            logger.error('Error executing end-game command', { 
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id 
            });
            await interaction.reply({ 
                content: error.userMessage || 'An error occurred while ending the game.', 
                ephemeral: true 
            });
        }
    },
};
