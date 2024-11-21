// commands/end-game.js

const { SlashCommandBuilder } = require('discord.js');
const { handleCommandError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end-game')
        .setDescription('End the current game'),

    async execute(interaction) {
        try {
            const game = interaction.client.games.get(interaction.guildId);
            
            if (!game) {
                await interaction.reply({
                    content: 'No active game to end.',
                    ephemeral: true
                });
                return;
            }

            // Check if user is game creator or authorized
            if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
                await interaction.reply({
                    content: 'Only the game creator can end the game.',
                    ephemeral: true
                });
                return;
            }

            // Log channel IDs before cleanup
            logger.info('Ending game with channels', {
                werewolfChannelId: game.werewolfChannel?.id,
                deadChannelId: game.deadChannel?.id
            });

            await game.shutdownGame();
            
            await interaction.reply({
                content: 'Game ended successfully. All game channels have been cleaned up.',
                ephemeral: false
            });

            logger.info('Game ended via command', {
                guildId: interaction.guildId,
                userId: interaction.user.id
            });

        } catch (error) {
            logger.error('Error ending game', {
                error,
                guildId: interaction.guildId,
                userId: interaction.user.id
            });
            await handleCommandError(interaction, error);
        }
    },
};
