const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const WerewolfGame = require('../game/WerewolfGame');
const { createRoleToggleButtons, createGameSetupButtons } = require('../utils/buttonCreator');
const { createRoleInfoEmbed } = require('../utils/embedCreator');
const ROLES = require('../constants/roles');
const GameStateManager = require('../utils/gameStateManager');

async function handleJoinGame(interaction, game) {
    try {
        const isAlreadyInGame = game.players.has(interaction.user.id);
        
        if (isAlreadyInGame) {
            // Remove player from game
            game.players.delete(interaction.user.id);
            await game.saveGameState();
            await interaction.reply({
                content: `${interaction.user} left (${game.players.size} players)`,
                ephemeral: false
            });
        } else {
            // Add player to game
            await game.addPlayer(interaction.user);
            await interaction.reply({
                content: `${interaction.user} joined (${game.players.size} players)`,
                ephemeral: false
            });
        }
    } catch (error) {
        logger.error('Error in handleJoinGame', {
            error: error.message,
            userId: interaction.user.id
        });
        throw error;
    }
}

async function handleToggleRole(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can modify roles.');
        }

        const role = interaction.customId.split('_')[1];
        const isAdding = interaction.customId.startsWith('add');

        try {
            if (isAdding) {
                game.addRole(role);
            } else {
                if (game.selectedRoles.has(role)) {
                    game.removeRole(role);
                }
            }
        } catch (error) {
            logger.warn('Error toggling role', { 
                error: error.message, 
                role,
                isAdding
            });
        }

        // Update with full game setup buttons, maintaining all buttons
        await interaction.update({
            components: createGameSetupButtons(game.selectedRoles)
        });
        await game.saveGameState();

    } catch (error) {
        throw error;
    }
}

async function handleViewRoles(interaction, game) {
    try {
        const roleInfoEmbed = {
            color: 0x0099ff,
            title: 'Role Information',
            fields: [
                {
                    name: '🐺 Werewolf',
                    value: 'Vote each night to eliminate a player. Win when werewolves equal or outnumber villagers.',
                    inline: false
                },
                {
                    name: '👁️ Seer',
                    value: 'Investigate one player each night to learn if they are a werewolf.',
                    inline: false
                },
                {
                    name: '🛡️ Bodyguard',
                    value: 'Protect one player each night from werewolf attacks.',
                    inline: false
                },
                {
                    name: '💘 Cupid',
                    value: 'Choose two players to be lovers at the start. If one dies, both die.',
                    inline: false
                },
                {
                    name: '🏹 Hunter',
                    value: 'When killed, take one other player with you.',
                    inline: false
                },
                {
                    name: '🦹 Minion',
                    value: 'Know the werewolves but unknown to them. Win with werewolves.',
                    inline: false
                },
                {
                    name: '🧙 Sorcerer',
                    value: 'Each night, investigate one player to learn if they are the Seer. Win with werewolves.',
                    inline: false
                },
                {
                    name: '👥 Villager',
                    value: 'Vote during the day to eliminate suspicious players.',
                    inline: false
                }
            ]
        };

        await interaction.reply({
            embeds: [roleInfoEmbed],
            ephemeral: true
        });
    } catch (error) {
        throw error;
    }
}

async function handleViewSetup(interaction, game) {
    try {
        // Format selected roles with emojis
        const roleEmojis = {
            'bodyguard': '🛡️',
            'cupid': '💘',
            'hunter': '🏹',
            'minion': '🦹',
            'sorcerer': '🧙'
        };

        const selectedRolesFormatted = Array.from(game.selectedRoles.keys())
            .map(role => `${roleEmojis[role.toLowerCase()] || ''} ${role}`)
            .join('\n');

        const setupEmbed = {
            color: 0x0099ff,
            title: '🎮 Current Game Setup',
            fields: [
                {
                    name: '👥 Players',
                    value: game.players.size > 0 
                        ? Array.from(game.players.values())
                            .map(p => `• ${p.username}`)
                            .join('\n')
                        : 'No players yet',
                    inline: true
                },
                {
                    name: '🎭 Optional Roles',
                    value: selectedRolesFormatted || 'None selected',
                    inline: true
                }
            ],
            footer: {
                text: 'Toggle roles using the buttons below'
            }
        };

        await interaction.reply({
            embeds: [setupEmbed],
            ephemeral: true
        });
    } catch (error) {
        throw error;
    }
}

async function handleResetRoles(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can reset roles.');
        }

        game.selectedRoles.clear();
        await interaction.update({
            components: createGameSetupButtons()
        });
        await game.saveGameState();
    } catch (error) {
        throw error;
    }
}

async function handleStartGame(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can start the game.');
        }

        await game.startGame();
        try {
            await interaction.update({
                components: [] // Remove all buttons after game starts
            });
        } catch (error) {
            // Ignore unknown interaction errors after game start
            if (error.code !== 10062) {
                throw error;
            }
            // Otherwise just log it
            logger.debug('Interaction expired after game start - this is normal');
        }
    } catch (error) {
        throw error;
    }
}

module.exports = {
    handleJoinGame,
    handleToggleRole,
    handleViewRoles,
    handleViewSetup,
    handleResetRoles,
    handleStartGame
};
