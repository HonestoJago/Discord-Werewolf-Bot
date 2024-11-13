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
            await interaction.client.endGame(interaction.guildId);
            await interaction.reply('Game has been ended.');
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
