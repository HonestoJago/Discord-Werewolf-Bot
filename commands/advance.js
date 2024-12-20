// commands/advance.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const PHASES = require('../constants/phases');
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

            // Add phase validation
            if (currentGame.phase === PHASES.NIGHT && currentGame.expectedNightActions.size > 0) {
                throw new GameError(
                    'Actions pending',
                    'Cannot advance phase while night actions are pending.'
                );
            }

            // Defer reply since we might need to do a lot of processing
            await interaction.deferReply({ ephemeral: true });

            const currentPhase = currentGame.phase;
            const channel = await interaction.client.channels.fetch(currentGame.gameChannelId);
            
            // Save state before transition
            await currentGame.saveGameState();

            switch (currentPhase) {
                case PHASES.DAY:
                    await currentGame.advanceToNight();
                    break;
                case PHASES.NIGHT:
                    await currentGame.advanceToDay();
                    break;
                case PHASES.NIGHT_ZERO:
                    await currentGame.finishNightZero();
                    break;
                default:
                    throw new GameError('Invalid phase', 'Cannot advance from the current game phase.');
            }

            // Save state after transition
            await currentGame.saveGameState();

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

