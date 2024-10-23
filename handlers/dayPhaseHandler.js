const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const { createNominationEmbed, createVotingEmbed, createVoteResultsEmbed } = require('../utils/embedCreator');

module.exports = {
    // Only handle button and select menu interactions
    async handleButton(interaction, currentGame) {
        const [action, targetId] = interaction.customId.split('_');

        try {
            switch(action) {
                case 'nominate':
                    // Show player selection menu
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('day_select_player')
                        .setPlaceholder('Select a player to nominate')
                        .addOptions(
                            Array.from(currentGame.players.values())
                                .filter(p => p.isAlive && p.id !== interaction.user.id)
                                .map(p => ({
                                    label: p.username,
                                    value: p.id
                                }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await interaction.reply({
                        embeds: [createNominationSelectEmbed(currentGame.players)],
                        components: [row],
                        ephemeral: true
                    });
                    break;

                case 'second':
                    await currentGame.second(interaction.user.id);
                    break;

                case 'vote':
                    const [, , vote] = interaction.customId.split('_');
                    await currentGame.submitVote(interaction.user.id, vote === 'guilty');
                    await interaction.reply({
                        content: 'Your vote has been recorded.',
                        ephemeral: true
                    });
                    break;
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },

    async handleSelect(interaction, currentGame) {
        try {
            if (interaction.customId === 'day_select_player') {
                const targetId = interaction.values[0];
                await currentGame.nominate(interaction.user.id, targetId);
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
