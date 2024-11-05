// commands/join.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const PHASES = require('../constants/phases');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join the Werewolf game.'),
    async execute(interaction, gameInstance) {
        // First check if command is used in DM
        if (!interaction.guild) {
            throw new GameError('Invalid channel', 'The join command can only be used in the server, not in DMs.');
        }

        // Then check if game exists
        if (!gameInstance) {
            throw new GameError('No game', 'There is no active game to join.');
        }

        // Log the actual phase
        logger.info('Join command received', {
            phase: gameInstance.phase,
            isLobby: gameInstance.phase === PHASES.LOBBY,
            actualPhase: gameInstance.phase  // Add this to see exact phase value
        });
        
        try {
            // Add the player to the game (addPlayer has its own phase check)
            gameInstance.addPlayer(interaction.user);

            await interaction.reply({ content: 'You have successfully joined the Werewolf game!', ephemeral: true });
            await gameInstance.broadcastMessage(`**${interaction.user.username}** has joined the game.`);
            logger.info('Player joined the game', { 
                userId: interaction.user.id, 
                username: interaction.user.username,
                phase: gameInstance.phase 
            });
        } catch (error) {
            logger.error('Error executing /join command', { error, userId: interaction.user.id });
            await interaction.reply({ content: error.userMessage || 'An error occurred while joining the game.', ephemeral: true });
        }
    },
};
