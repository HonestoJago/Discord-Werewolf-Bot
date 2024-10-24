// commands/end-game.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end-game')
        .setDescription('End the current game'),

    async execute(interaction) {
        try {
            const game = interaction.client.games.get(interaction.guildId);
            if (!game) {
                throw new GameError('No Active Game', 'There is no active game to end.');
            }

            await game.shutdownGame();
            interaction.client.games.delete(interaction.guildId);
            
            await interaction.reply('Game has been ended.');
            
            logger.info('Game ended by user', {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
