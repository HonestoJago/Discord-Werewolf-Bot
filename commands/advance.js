// commands/advance.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const PHASES = require('../constants/phases');
const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const { createDayTransitionEmbed, createNightTransitionEmbed } = require('../utils/embedCreator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('advance')
        .setDescription('Advances the game to the next phase.'),
    async execute(interaction, currentGame) {
        try {
            if (!interaction.guild) {
                throw new GameError('Not in server', 'This command can only be used in a server channel.');
            }

            if (!currentGame) {
                throw new GameError('No game', 'There is no active game.');
            }

            if (interaction.user.id !== currentGame.gameCreatorId) {
                throw new GameError('Not authorized', 'Only the game creator can advance phases.');
            }

            // Defer reply since we might need to do a lot of processing
            await interaction.deferReply({ ephemeral: true });

            const currentPhase = currentGame.phase;
            const channel = await interaction.client.channels.fetch(currentGame.gameChannelId);
            
            switch (currentPhase) {
                case PHASES.DAY:
                    // Send night transition before advancing
                    await channel.send({
                        embeds: [createNightTransitionEmbed(currentGame.players)]
                    });
                    await currentGame.advanceToNight();
                    break;
                case PHASES.NIGHT:
                    // Send day transition before advancing
                    await channel.send({
                        embeds: [createDayTransitionEmbed()]
                    });
                    await currentGame.advanceToDay();
                    break;
                case PHASES.NIGHT_ZERO:
                    await currentGame.finishNightZero();
                    break;
                default:
                    throw new GameError('Invalid phase', 'Cannot advance from the current game phase.');
            }

            // Log the phase change
            logger.info('Phase manually advanced', { 
                userId: interaction.user.id,
                fromPhase: currentPhase,
                toPhase: currentGame.phase,
                round: currentGame.round
            });

            // Edit the deferred reply
            await interaction.editReply({ 
                content: `Successfully advanced from ${currentPhase} to ${currentGame.phase} (Round ${currentGame.round}).`
            });

        } catch (error) {
            if (interaction.deferred) {
                await interaction.editReply({ 
                    content: error instanceof GameError ? error.userMessage : 'Failed to advance phase.' 
                });
            } else {
                await handleCommandError(interaction, error);
            }
        }
    }
};

