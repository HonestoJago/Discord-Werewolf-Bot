const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { handleCommandError, GameError } = require('../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-roles')
        .setDescription('List all assigned roles.'),
    async execute(interaction, currentGame) {
        try {
            if (!currentGame) {
                throw new GameError('No active game', 'There is no active game in this channel.');
            }

            const roleList = Array.from(currentGame.players.values())
                .map(player => `${player.username}: ${player.role} (${player.isAlive ? 'Alive' : 'Dead'})`)
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Assigned Roles')
                .setDescription(roleList)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: false });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
