// commands/action.js

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const PHASES = require('../constants/phases');
const ROLES = require('../constants/roles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('action')
        .setDescription('Submit your night action. This is a fallback for the dropdown menu in your DMs.')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Your night action')
                .setRequired(true)
                .addChoices(
                    { name: 'Attack (Werewolf)', value: 'attack' },
                    { name: 'Investigate (Seer)', value: 'investigate' },
                    { name: 'Protect (Bodyguard)', value: 'protect' },
                    { name: 'Choose Lovers (Cupid)', value: 'choose_lovers' },
                    { name: 'Choose Target (Hunter)', value: 'choose_target' }
                ))
        .addStringOption(option =>
            option.setName('target')
                .setDescription('Select your target')
                .setRequired(true)
                .setAutocomplete(true)),

    async execute(interaction, currentGame) {
        try {
            // Verify we're in DMs
            if (interaction.guild) {
                throw new GameError('Not in DM', 'This command can only be used in direct messages with the bot.');
            }

            // Find the game if not provided (since we're in DMs)
            if (!currentGame) {
                for (const [, gameInstance] of interaction.client.games) {
                    if (gameInstance.players.has(interaction.user.id)) {
                        currentGame = gameInstance;
                        break;
                    }
                }
            }

            if (!currentGame) {
                throw new GameError('No game', 'You are not part of any ongoing game.');
            }

            const action = interaction.options.getString('action');
            const targetId = interaction.options.getString('target');
            const player = currentGame.players.get(interaction.user.id);

            if (!player) {
                throw new GameError('Invalid player', 'You are not part of this game.');
            }

            // Check if this is a Hunter's revenge action
            const isHunterRevenge = 
                player.role === ROLES.HUNTER && 
                currentGame.pendingHunterRevenge === player.id;

            // Validate phase - allow Hunter's revenge during any phase
            if (!isHunterRevenge && 
                currentGame.phase !== PHASES.NIGHT && 
                currentGame.phase !== PHASES.NIGHT_ZERO) {
                throw new GameError('Wrong phase', 'Actions can only be submitted during the night phase.');
            }

            const target = currentGame.players.get(targetId);
            if (!target) {
                throw new GameError('Invalid target', 'The selected target is not valid.');
            }

            // Process the action
            if (isHunterRevenge) {
                await currentGame.voteProcessor.processHunterRevenge(player.id, targetId);
                await interaction.reply({
                    content: 'Your revenge has been executed.',
                    ephemeral: true
                });
                return;
            }

            // Special handling for Cupid's Night Zero action
            if (player.role === ROLES.CUPID && currentGame.phase === PHASES.NIGHT_ZERO) {
                await currentGame.nightActionProcessor.processNightZeroAction(
                    player.id,
                    targetId
                );
            } else {
                await currentGame.processNightAction(interaction.user.id, action, targetId);
            }

            // Reply based on action type
            if (action === 'investigate') {
                await interaction.reply({ 
                    content: 'Investigation complete. Check your DMs for the results.',
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: 'Action submitted.',
                    ephemeral: true 
                });
            }

            logger.info('Night action submitted', { 
                userId: interaction.user.id, 
                action, 
                targetId 
            });

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
            // For DMs, search all games for this player
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

            if (!player) {
                return await interaction.respond([]);
            }

            // Get valid targets based on the action and player role
            let validTargets = Array.from(currentGame.players.values())
                .filter(p => p.isAlive && p.id !== player.id)
                .map(p => ({
                    name: p.username,
                    value: p.id
                }));

            // Action-specific filtering
            switch (action) {
                case 'investigate':
                    if (player.role !== ROLES.SEER || 
                        (currentGame.phase !== PHASES.NIGHT && 
                         currentGame.phase !== PHASES.NIGHT_ZERO)) {
                        return await interaction.respond([]);
                    }
                    break;
                case 'protect':
                    if (player.role !== ROLES.BODYGUARD || 
                        (currentGame.phase !== PHASES.NIGHT && 
                         currentGame.phase !== PHASES.NIGHT_ZERO)) {
                        return await interaction.respond([]);
                    }
                    validTargets = validTargets.filter(p => 
                        p.value !== currentGame.lastProtectedPlayer
                    );
                    break;
                case 'attack':
                    if (player.role !== ROLES.WEREWOLF || 
                        (currentGame.phase !== PHASES.NIGHT && 
                         currentGame.phase !== PHASES.NIGHT_ZERO)) {
                        return await interaction.respond([]);
                    }
                    validTargets = validTargets.filter(p => 
                        currentGame.players.get(p.value).role !== ROLES.WEREWOLF
                    );
                    break;
                case 'choose_lovers':
                    if (player.role !== ROLES.CUPID || 
                        currentGame.phase !== PHASES.NIGHT_ZERO) {
                        return await interaction.respond([]);
                    }
                    validTargets = validTargets.filter(p => p.value !== player.id);
                    break;
                case 'choose_target':
                    // Allow Hunter's revenge during any phase if pending
                    if (player.role !== ROLES.HUNTER || 
                        player.id !== currentGame.pendingHunterRevenge) {
                        return await interaction.respond([]);
                    }
                    // Only show living players as valid targets
                    validTargets = validTargets.filter(p => 
                        currentGame.players.get(p.value).isAlive
                    );
                    break;
                default:
                    return await interaction.respond([]);
            }

            // Filter based on user input
            const filtered = validTargets
                .filter(choice => 
                    choice.name.toLowerCase().includes(focusedValue.toLowerCase())
                )
                .slice(0, 25);

            await interaction.respond(filtered);
        } catch (error) {
            logger.error('Error in action autocomplete', { error });
            await interaction.respond([]);
        }
    }
};
