const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const { createDayPhaseEmbed, createNominationEmbed, createVotingEmbed } = require('../utils/embedCreator');

module.exports = {
    async createDayPhaseUI(channel, players) {
        // Create dropdown menu of alive players
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('day_select_target')
            .setPlaceholder('Select a player to nominate')
            .addOptions(
                Array.from(players.values())
                    .filter(p => p.isAlive)
                    .map(p => ({
                        label: p.username,
                        value: p.id,
                        description: `Nominate ${p.username} for elimination`
                    }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = createDayPhaseEmbed(players);

        await channel.send({
            embeds: [embed],
            components: [row]
        });
    },

    async handleSelect(interaction, currentGame) {
        try {
            const targetId = interaction.values[0];
            const target = currentGame.players.get(targetId);
            
            // Create nomination
            await currentGame.nominate(interaction.user.id, targetId);

            // Create second button
            const secondButton = new ButtonBuilder()
                .setCustomId(`second_${targetId}`)
                .setLabel('Second This Nomination')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(secondButton);

            // Send nomination announcement with second button
            await interaction.reply({
                embeds: [createNominationEmbed(interaction.user.username, target.username)],
                components: [row]
            });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },

    async handleButton(interaction, currentGame) {
        try {
            const [action, targetId] = interaction.customId.split('_');
            
            if (action === 'second') {
                // First handle the seconding
                await currentGame.second(interaction.user.id);
                await interaction.reply({ 
                    content: 'You have seconded the nomination.', 
                    ephemeral: true 
                });

                // Then create and send a new message with voting buttons
                const lynchButton = new ButtonBuilder()
                    .setCustomId(`vote_${targetId}_guilty`)
                    .setLabel('Lynch')
                    .setStyle(ButtonStyle.Danger);

                const spareButton = new ButtonBuilder()
                    .setCustomId(`vote_${targetId}_innocent`)
                    .setLabel('Let Live')
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder()
                    .addComponents(lynchButton, spareButton);

                // Send voting message to channel, not as a reply
                const channel = await interaction.client.channels.fetch(currentGame.gameChannelId);
                await channel.send({
                    embeds: [createVotingEmbed(
                        currentGame.players.get(targetId),
                        currentGame.players.get(interaction.user.id)
                    )],
                    components: [row]
                });

                // Delete the original nomination message if possible
                try {
                    await interaction.message.delete();
                } catch (error) {
                    logger.warn('Could not delete nomination message', { error });
                }
            } else if (action === 'vote') {
                const [, targetId, vote] = interaction.customId.split('_');
                await currentGame.submitVote(interaction.user.id, vote === 'guilty');
                await interaction.reply({
                    content: `Your vote to ${vote === 'guilty' ? 'lynch' : 'spare'} has been recorded.`,
                    ephemeral: true
                });
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
