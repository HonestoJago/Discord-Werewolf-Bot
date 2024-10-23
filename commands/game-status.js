const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { handleCommandError, GameError } = require('../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('game-status')
        .setDescription('Display the current game status.'),
    async execute(interaction, currentGame) {
        try {
            if (!currentGame) {
                throw new GameError('No active game', 'There is no active game in this channel.');
            }

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Werewolf Game Status')
                .addFields(
                    { name: 'Phase', value: currentGame.phase, inline: true },
                    { name: 'Round', value: currentGame.round.toString(), inline: true },
                    { name: 'Players', value: currentGame.players.size.toString(), inline: true },
                    { name: 'Alive Players', value: currentGame.getAlivePlayers().length.toString(), inline: true },
                    { name: 'Werewolves', value: currentGame.getPlayersByRole('werewolf').length.toString(), inline: true },
                    { name: 'Villagers', value: (currentGame.getAlivePlayers().length - currentGame.getPlayersByRole('werewolf').length).toString(), inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: false });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
