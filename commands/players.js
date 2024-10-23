const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const { createPlayerListEmbed } = require('../utils/embedCreator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('players')
        .setDescription('Display the current list of players in the game lobby.'),
    async execute(interaction, currentGame) {
        try {
            const { guild, channel } = interaction;

            if (!guild) {
                throw new GameError('Not in server', 'This command can only be used in a server channel.');
            }

            if (!currentGame) {
                throw new GameError('No game', 'There is no game currently in the lobby. Ask someone to start a new game using the `/create` command.');
            }

            const embed = createPlayerListEmbed(currentGame.players, currentGame.phase);

            // Get the first allowed channel ID
            const allowedChannelId = process.env.ALLOWED_CHANNEL_IDS.split(',')[0];
            const targetChannel = await guild.channels.fetch(allowedChannelId);

            if (channel.id !== allowedChannelId) {
                await interaction.reply({ content: `Player list has been sent to ${targetChannel}.`, ephemeral: true });
            }

            await targetChannel.send({ embeds: [embed] });

            if (channel.id === allowedChannelId) {
                await interaction.reply({ content: 'Player list updated.', ephemeral: true });
            }

            logger.info({ userId: interaction.user.id, guildId: guild.id, channelId: channel.id }, 'Player list displayed');
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
