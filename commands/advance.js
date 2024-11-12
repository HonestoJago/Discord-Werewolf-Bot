// commands/advance.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const PHASES = require('../constants/phases');

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

            if (!currentGame.isGameCreatorOrAuthorized(interaction.user.id)) {
                throw new GameError('Not authorized', 'Only game administrators can advance phases.');
            }

            // Defer reply since we might need to do a lot of processing
            await interaction.deferReply({ ephemeral: true });

            const currentPhase = currentGame.phase;
            
            switch (currentPhase) {
                case PHASES.DAY:
                    // Clear any ongoing votes/nominations
                    currentGame.clearVotingState();
                    await currentGame.advanceToNight();
                    break;
                    
                case PHASES.NIGHT:
                    currentGame.phase = PHASES.DAY;
                    currentGame.round += 1;
                    const channel = await interaction.client.channels.fetch(currentGame.gameChannelId);
                    await currentGame.broadcastMessage(`Day ${currentGame.round} has begun!`);
                    await dayPhaseHandler.createDayPhaseUI(channel, currentGame.players);
                    break;
                    
                case PHASES.NIGHT_ZERO:
                    currentGame.phase = PHASES.DAY;
                    currentGame.round = 1;
                    const dayChannel = await interaction.client.channels.fetch(currentGame.gameChannelId);
                    await currentGame.broadcastMessage('The sun rises on the first day. Discuss and find the werewolves!');
                    await dayPhaseHandler.createDayPhaseUI(dayChannel, currentGame.players);
                    break;
                    
                default:
                    throw new GameError('Invalid phase', 'Cannot advance from current game phase.');
            }

            // Log the phase change
            logger.info('Phase manually advanced', { 
                userId: interaction.user.id,
                fromPhase: currentPhase,
                toPhase: currentGame.phase,
                round: currentGame.round
            });

            // Edit our deferred reply
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

