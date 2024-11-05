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
                    { name: 'Choose Lovers (Cupid)', value: 'choose_lovers' },
                    { name: 'Choose Target (Hunter)', value: 'hunter_revenge' }
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

    async autocomplete(interaction, currentGame) {
        try {
            // If no game found, search all games for this player
            if (!currentGame) {
                for (const [, gameInstance] of interaction.client.games) {
                    if (gameInstance.players.has(interaction.user.id)) {
                        currentGame = gameInstance;
                        break;
                    }
                }
            }

            if (!currentGame) {
                return await interaction.respond([]);
            }

            const focusedValue = interaction.options.getFocused();
            const action = interaction.options.getString('action');
            const player = currentGame.players.get(interaction.user.id);

            if (!player || !player.isAlive) {
                return await interaction.respond([]);
            }

            // Get valid targets based on the action and player role
            let validTargets = Array.from(currentGame.players.values())
                .filter(p => p.isAlive && p.id !== player.id);

            // Action-specific filtering
            switch (action) {
                case 'investigate':
                    if (player.role !== ROLES.SEER) return await interaction.respond([]);
                    break;
                case 'protect':
                    if (player.role !== ROLES.DOCTOR) return await interaction.respond([]);
                    validTargets = validTargets.filter(p => p.id !== currentGame.lastProtectedPlayer);
                    break;
                case 'attack':
                    if (player.role !== ROLES.WEREWOLF) return await interaction.respond([]);
                    validTargets = validTargets.filter(p => p.role !== ROLES.WEREWOLF);
                    break;
                case 'choose_lovers':
                    if (player.role !== ROLES.CUPID) return await interaction.respond([]);
                    break;
                case 'hunter_revenge':
                    if (player.role !== ROLES.HUNTER) return await interaction.respond([]);
                    break;
                default:
                    return await interaction.respond([]);
            }

            // Filter based on user input and create choices
            const choices = validTargets
                .filter(p => p.username.toLowerCase().includes(focusedValue.toLowerCase()))
                .map(p => ({
                    name: p.username,
                    value: p.id
                }));

            await interaction.respond(choices);
        } catch (error) {
            logger.error('Error in action autocomplete', { error });
            await interaction.respond([]);
        }
    }
};
