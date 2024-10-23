// commands/vote.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Submit your vote for elimination. Use this command in DMs only.')
        .addStringOption(option =>
            option.setName('target')
                .setDescription('The username of the player you want to vote for.')
                .setRequired(true)),
    async execute(interaction, currentGame) {
        try {
            if (interaction.guild) {
                await interaction.reply({ content: 'Please use this command in DMs only.', ephemeral: true });
                return;
            }

            const { user, options } = interaction;
            const targetUsername = options.getString('target');

            if (!currentGame) {
                throw new GameError('No active game.', 'There is no active game. Please wait for a game to start.');
            }

            await currentGame.collectVote(user.id, targetUsername);
            await interaction.reply({ content: 'Your vote has been recorded.', ephemeral: true });
            logger.info({ userId: user.id, target: targetUsername }, 'Vote submitted');
        } catch (error) {
            if (error instanceof GameError) {
                logger.warn({ userId: interaction.user.id, error: error.message }, 'Game error in /vote command');
            } else {
                logger.error({ error, userId: interaction.user.id }, 'Error in /vote command');
            }
            await handleCommandError(interaction, error);
        }
    },
};
