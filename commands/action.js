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
                .setDescription('Your night action')
                .setRequired(true)
                .addChoices(
                    { name: 'Attack (Werewolf)', value: 'attack' },
                    { name: 'Investigate (Seer)', value: 'investigate' },
                    { name: 'Protect (Doctor)', value: 'protect' },
                    { name: 'Choose Lovers (Cupid)', value: 'choose_lovers' }
                ))
        .addStringOption(option =>
            option.setName('target')
                .setDescription('Select your target')
                .setRequired(true)
                .setAutocomplete(true)),

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
    },

    async autocomplete(interaction, gameInstance) {
        const focusedValue = interaction.options.getFocused();
        const action = interaction.options.getString('action');
        const player = gameInstance.players.get(interaction.user.id);

        // Get valid targets based on the action and player role
        let choices = [];
        if (player && player.isAlive) {
            let validTargets = Array.from(gameInstance.players.values())
                .filter(p => p.isAlive);

            // Filter based on action type
            if (action === 'investigate') {
                validTargets = validTargets.filter(p => p.id !== player.id);
            } else if (action === 'protect' && player.role === ROLES.DOCTOR) {
                validTargets = validTargets.filter(p => p.id !== gameInstance.lastProtectedPlayer);
            }

            choices = validTargets.map(p => ({
                name: p.username,
                value: p.id
            }));
        }

        // Filter based on user input
        const filtered = choices.filter(choice => 
            choice.name.toLowerCase().includes(focusedValue.toLowerCase())
        );

        await interaction.respond(filtered);
    }
};
