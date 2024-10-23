// commands/advance.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('advance')
        .setDescription('Advances the game to the next phase.'),
    async execute(interaction, currentGame) {
        try {
            const { guild, channel, user } = interaction;

            if (!guild) {
                throw new GameError('Not in server', 'This command can only be used in a server channel.');
            }

            if (!currentGame) {
                throw new GameError('No game', 'There is no active game in this channel. Start a new game using the `/create` command.');
            }

            if (!currentGame.isGameCreatorOrAuthorized(user.id)) {
                throw new GameError('Not authorized', 'You do not have permission to advance the phase.');
            }

            await currentGame.advancePhase(user.id);
            await interaction.reply({ content: 'Game phase has been advanced. Check the game channel for updates on the new phase.', ephemeral: false });
            logger.info({ userId: user.id, guildId: guild.id, channelId: channel.id }, 'Phase advanced');
        } catch (error) {
            if (error instanceof GameError) {
                logger.warn({ userId: interaction.user.id, error: error.message }, 'Game error in /advance command');
            } else {
                logger.error({ error, userId: interaction.user.id }, 'Error in /advance command');
            }
            await handleCommandError(interaction, error);
        }
    },
};
