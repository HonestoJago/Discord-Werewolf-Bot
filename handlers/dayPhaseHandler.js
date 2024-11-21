const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const { createDayPhaseEmbed, createNominationEmbed, createVotingEmbed, createDayTransitionEmbed } = require('../utils/embedCreator');
const PHASES = require('../constants/phases');

module.exports = {
    async createDayPhaseUI(channel, players) {
        try {
            // Create the day phase UI with player status
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
        } catch (error) {
            logger.error('Error creating day phase UI', { error });
            throw error;
        }
    },

    async handleSelect(interaction, currentGame) {
        try {
            // Check for active nomination first
            if (currentGame.nominatedPlayer) {
                await interaction.reply({
                    content: 'A nomination is already in progress. Please wait for it to conclude.',
                    ephemeral: true
                });
                return;
            }

            const targetId = interaction.values[0];
            const target = currentGame.players.get(targetId);
            
            // Use voteProcessor to handle the nomination
            await currentGame.voteProcessor.nominate(interaction.user.id, targetId);

            // Instead of calling GameStateManager directly, use the game instance
            await currentGame.saveGameState();

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
            const [action, targetId, vote] = interaction.customId.split('_');
            
            // Check if game still exists and is valid
            if (!currentGame) {
                await interaction.reply({
                    content: 'No active game found.',
                    ephemeral: true
                });
                return;
            }

            // Check if game is over BEFORE any other processing
            if (currentGame.gameOver || currentGame.phase === PHASES.GAME_OVER) {
                try {
                    await interaction.reply({
                        content: 'This game has ended.',
                        ephemeral: true
                    });
                } catch (error) {
                    // If we can't reply, just log it - the game is over anyway
                    logger.warn('Could not reply to interaction in ended game', {
                        error: error.message,
                        interactionId: interaction.id
                    });
                }
                return;
            }

            if (action === 'vote') {
                // Check if player is the nominated target
                if (interaction.user.id === currentGame.nominatedPlayer) {
                    await interaction.reply({
                        content: 'You cannot vote in your own nomination.',
                        ephemeral: true
                    });
                    return;
                }

                // Check if player is alive
                const voter = currentGame.players.get(interaction.user.id);
                if (!voter?.isAlive) {
                    await interaction.reply({
                        content: 'Only living players can vote.',
                        ephemeral: true
                    });
                    return;
                }

                try {
                    // Submit the vote through voteProcessor
                    const result = await currentGame.voteProcessor.submitVote(interaction.user.id, vote === 'guilty');
                    await interaction.reply({
                        content: `Your vote to ${vote === 'guilty' ? 'lynch' : 'spare'} has been recorded.`,
                        ephemeral: true
                    });

                    // If game ended after this vote, don't try to update UI
                    if (currentGame.gameOver) {
                        return;
                    }
                } catch (error) {
                    // Ignore unknown interaction errors
                    if (error.code !== 10062) {
                        logger.error('Error processing vote', { error });
                    }
                }
            } else if (action === 'second') {
                try {
                    // Use voteProcessor directly
                    await currentGame.voteProcessor.second(interaction.user.id);
                    await interaction.reply({ 
                        content: 'You have seconded the nomination.', 
                        ephemeral: true 
                    });

                    // Only proceed if game hasn't ended
                    if (!currentGame.gameOver) {
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
                                currentGame.players.get(interaction.user.id),
                                currentGame
                            )],
                            components: [row]
                        });

                        // Delete the original nomination message if possible
                        try {
                            await interaction.message.delete();
                        } catch (error) {
                            logger.warn('Could not delete nomination message', { error });
                        }
                    }
                } catch (error) {
                    logger.error('Error processing second', { error });
                    if (!interaction.replied) {
                        await interaction.reply({
                            content: error instanceof GameError ? error.userMessage : 'Failed to process your action.',
                            ephemeral: true
                        });
                    }
                }
            }
        } catch (error) {
            logger.error('Error in handleButton', { 
                error: error.message,
                stack: error.stack,
                interactionId: interaction.id
            });
            
            // Only try to reply if we haven't already and game isn't over
            if (!interaction.replied && !interaction.deferred && !currentGame?.gameOver) {
                try {
                    await interaction.reply({
                        content: 'An error occurred while processing your action.',
                        ephemeral: true
                    });
                } catch (replyError) {
                    logger.error('Failed to send error reply', { replyError });
                }
            }
        }
    }
};
