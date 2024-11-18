const { DataTypes } = require('sequelize');
const { sequelize } = require('../utils/database');
const PHASES = require('../constants/phases');

const Game = sequelize.define('Game', {
    // Primary identification
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },

    // Core game channels
    channelId: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    werewolfChannelId: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isDiscordId(value) {
                if (value && !/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    deadChannelId: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isDiscordId(value) {
                if (value && !/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    categoryId: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isDiscordId(value) {
                if (value && !/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },

    // Game creator
    creatorId: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },

    // Game state
    phase: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isIn: [Object.values(PHASES)]
        }
    },
    round: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },

    // UI state tracking
    activeMessageIds: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // Stores message IDs for updating UI elements
        // {
        //     dayPhaseMessage: string,
        //     votingMessage: string,
        //     lastAnnouncement: string,
        //     activePrompts: { userId: messageId }
        // }
    },

    // Player states
    players: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // Stores complete player information
        // {
        //     id: {
        //         discordId: string,
        //         username: string,
        //         discriminator: string,
        //         role: string,
        //         isAlive: boolean,
        //         isProtected: boolean,
        //         lastAction: string,
        //         actionTarget: string
        //     }
        // }
    },

    // Voting state
    votingState: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     nominatedPlayer: string,
        //     nominator: string,
        //     seconder: string,
        //     votingOpen: boolean,
        //     votes: { voterId: boolean },
        //     nominationStartTime: number,
        //     votingMessageId: string
        // }
    },

    // Night actions
    nightState: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     expectedActions: string[],
        //     completedActions: string[],
        //     pendingActions: { 
        //         playerId: { 
        //             action: string, 
        //             target: string 
        //         } 
        //     },
        //     lastProtectedPlayer: string
        // }
    },

    // Special role relationships
    specialRoles: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     lovers: { playerId: loverId },
        //     pendingHunterRevenge: string,
        //     selectedRoles: { role: count }
        // }
    },

    // Timestamps
    lastUpdated: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    gameStartTime: {
        type: DataTypes.DATE,
        allowNull: true
    },

    // Message history for UI restoration
    messageHistory: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     lastDayPhaseEmbed: { content: string, components: array },
        //     lastVotingEmbed: { content: string, components: array },
        //     pendingPrompts: { 
        //         userId: {
        //             type: string, // 'night_action', 'vote', etc.
        //             content: string,
        //             components: array,
        //             expiresAt: number
        //         }
        //     }
        // }
    },

    // Channel permissions backup
    channelPermissions: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     werewolfChannel: { userId: ['VIEW_CHANNEL', 'SEND_MESSAGES'] },
        //     deadChannel: { userId: ['VIEW_CHANNEL', 'SEND_MESSAGES'] }
        // }
    },

    // Active timers and cooldowns
    timers: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     nominationTimeout: number,
        //     nightActionDeadline: number,
        //     hunterRevengeDeadline: number
        // }
    },

    // Role-specific history and state
    roleHistory: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     seer: {
        //         investigations: [
        //             { 
        //                 seerId: string,
        //                 targetId: string,
        //                 round: number,
        //                 result: boolean,  // true = werewolf
        //                 timestamp: number
        //             }
        //         ]
        //     },
        //     bodyguard: {
        //         protections: [
        //             {
        //                 round: number,
        //                 targetId: string,
        //                 successful: boolean  // true if blocked attack
        //             }
        //         ]
        //     },
        //     // Easy to add new roles:
        //     // witch: { potions: [] },
        //     // mason: { reveals: [] },
        //     // etc.
        //     }
    },

    // Track all actions and their outcomes for history/stats
    actionLog: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
        // {
        //     round: [
        //         {
        //             phase: string,
        //             action: string,
        //             playerId: string,
        //             targetId: string,
        //             result: string,
        //             timestamp: number
        //         }
        //     ]
        // }
    }
}, {
    // Add hooks to validate JSON structures
    hooks: {
        beforeValidate: (game) => {
            // Ensure JSON fields have correct structure
            if (typeof game.players !== 'object') game.players = {};
            if (typeof game.votingState !== 'object') game.votingState = {};
            if (typeof game.nightState !== 'object') game.nightState = {};
            if (typeof game.specialRoles !== 'object') game.specialRoles = {};
            if (typeof game.activeMessageIds !== 'object') game.activeMessageIds = {};
        }
    }
});

module.exports = Game; 