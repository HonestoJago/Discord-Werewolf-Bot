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

            // Advance the phase
            await currentGame.advancePhase();

            // Reply with appropriate message based on new phase
            const phaseMessages = {
                [PHASES.DAY]: 'Day phase has begun. Players may now discuss and vote.',
                [PHASES.NIGHT]: 'Night has fallen. Check your DMs for night actions.',
                [PHASES.NIGHT_ZERO]: 'Night Zero has begun. Special roles, check your DMs.'
            };

            await interaction.reply({ 
                content: phaseMessages[currentGame.phase] || 'Phase advanced.',
                ephemeral: true 
            });

            logger.info('Phase advanced', { 
                userId: interaction.user.id,
                newPhase: currentGame.phase,
                round: currentGame.round
            });

        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};

