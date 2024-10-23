// commands/action.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const PHASES = require('../constants/phases');
const ROLES = require('../constants/roles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('action')
        .setDescription('Submit your night action. Use this command in DMs only.')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Your night action (attack, investigate, protect, choose_lovers).')
                .setRequired(true)
                .addChoices(
                    { name: 'Attack', value: 'attack' },
                    { name: 'Investigate', value: 'investigate' },
                    { name: 'Protect', value: 'protect' },
                    { name: 'Choose Lovers', value: 'choose_lovers' }
                ))
        .addStringOption(option =>
            option.setName('target')
                .setDescription('The username of the target player (or two usernames separated by a comma for choosing lovers).')
                .setRequired(true)),

    async execute(interaction, currentGame) {
        try {
            // Only Discord-specific validation
            if (interaction.guild) {
                throw new GameError('Not in DM', 'This command can only be used in direct messages with the bot.');
            }

            // Basic game existence check
            if (!currentGame) {
                throw new GameError('No game', 'You are not part of any ongoing game.');
            }

            const { user, options } = interaction;
            const action = options.getString('action');
            const target = options.getString('target');

            // Let the game handle all game-specific validations
            await currentGame.processNightAction(user.id, action, target);
            
            await interaction.reply({ 
                content: 'Your action has been recorded. Wait for the night phase to end to see the results.',
                ephemeral: true 
            });
            
            logger.info({ userId: user.id, action, target }, 'Night action submitted');

        } catch (error) {
            if (error instanceof GameError) {
                await interaction.reply({ content: error.userMessage, ephemeral: true });
            } else {
                await handleCommandError(interaction, error);
            }
        }
    }
};
