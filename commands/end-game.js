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

            await game.shutdownGame();
            
            await interaction.reply({
                content: 'Game ended successfully.',
                ephemeral: false
            });

            logger.info('Game ended via command', {
                guildId: interaction.guildId,
                userId: interaction.user.id
            });

        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
