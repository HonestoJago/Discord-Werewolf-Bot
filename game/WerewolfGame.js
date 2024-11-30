// game/WerewolfGame.js

const Player = require('./Player');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');  // Direct import of frozen object
const PHASES = require('../constants/phases'); // Direct import of frozen object
const { 
    createDayPhaseEmbed, 
    createVoteResultsEmbed, 
    createGameEndEmbed,
    createDayTransitionEmbed, 
    createNightTransitionEmbed,
    createGameWelcomeEmbed,
    createHunterTensionEmbed,
    createHunterRevengePromptEmbed,  // Add this
    createHunterRevengeEmbed,
    createHunterRevengeFallbackEmbed
} = require('../utils/embedCreator');
const NightActionProcessor = require('./NightActionProcessor');
const VoteProcessor = require('./VoteProcessor');
const PlayerStats = require('../models/Player');
const Game = require('../models/Game');
const { createGameEndButtons } = require('../utils/buttonCreator');
const GameStateManager = require('../utils/gameStateManager');
const PlayerStateManager = require('./PlayerStateManager');
const { createGameSetupButtons } = require('../utils/buttonCreator');
const RateLimiter = require('../utils/rateLimiter');
const SecurityManager = require('../utils/securityManager');
const InputValidator = require('../utils/inputValidator');

// Define roles and their properties in a configuration object
const ROLE_CONFIG = {
    [ROLES.WEREWOLF]: { maxCount: (playerCount) => Math.max(1, Math.floor(playerCount / 4)) },
    [ROLES.SEER]: { maxCount: 1 },
    [ROLES.BODYGUARD]: { maxCount: 1 },
    [ROLES.CUPID]: { maxCount: 1 },
    [ROLES.HUNTER]: { maxCount: 1 },
    [ROLES.MINION]: { maxCount: 1 },
    [ROLES.SORCERER]: { maxCount: 1 },
    [ROLES.VILLAGER]: { maxCount: (playerCount) => playerCount }
};

const PHASE_TRANSITIONS = {
    [PHASES.LOBBY]: ['NIGHT_ZERO'],
    [PHASES.NIGHT_ZERO]: ['DAY'],
    [PHASES.DAY]: ['NIGHT', 'GAME_OVER'],
    [PHASES.NIGHT]: ['DAY', 'GAME_OVER'],
    [PHASES.GAME_OVER]: []
};

// Add this near the top with other constants
const MIN_PLAYERS = process.env.NODE_ENV === 'development' ? 4 : 6;

class WerewolfGame {
    constructor(client, guildId, gameChannelId, gameCreatorId, authorizedIds = []) {
        if (!client) {
            throw new Error('Discord client is required');
        }
        if (!guildId) {
            throw new Error('Guild ID is required');
        }
        if (!gameChannelId) {
            throw new Error('Game channel ID is required');
        }
        if (!gameCreatorId) {
            throw new Error('Game creator ID is required');
        }

        this.client = client;
        this.guildId = guildId;
        this.gameChannelId = gameChannelId;
        this.gameCreatorId = gameCreatorId;
        this.authorizedIds = authorizedIds; // Array of user IDs authorized to advance phases

        this.players = new Map(); // Map of playerId -> Player instance
        this.phase = PHASES.LOBBY;  // This should be set to LOBBY
        this.round = 0;
        this.nightActions = {}; // Store night actions like attacks, investigations, etc.
        this.werewolfChannel = null; // Private channel for werewolves
        this.deadChannel = null; // Channel for dead players
        this.gameOver = false;
        this.lastProtectedPlayer = null; // Track the last protected player
        this.lovers = new Map(); // Store lover pairs
        this.selectedRoles = new Map(); // Dynamic role selection
        this.pendingHunterRevenge = null;  // Track if Hunter needs to take revenge

        // Voting state
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votes = new Map();   // Map of voterId -> boolean (true = guilty, false = innocent))
        this.votingOpen = false;
        this.nominationTimeout = null;
        this.NOMINATION_WAIT_TIME = 60000; // 1 minute
        
        // Add tracking for completed night actions
        this.completedNightActions = new Set(); // Track which players have completed their actions
        this.expectedNightActions = new Set(); // Track which players are expected to act
        
        logger.info('Game created with phase', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY,
            phaseValue: PHASES.LOBBY  // Add this to verify PHASES.LOBBY value
        });

        // Add the processors
        this.nightActionProcessor = new NightActionProcessor(this);
        this.voteProcessor = new VoteProcessor(this);
    
        // Set up periodic state saving
        this.stateSaveInterval = setInterval(async () => {
            try {
                await GameStateManager.saveGameState(this);
            } catch (error) {
                logger.error('Error in periodic state save', { error });
            }
        }, 5 * 60 * 1000); // Save every 5 minutes

        // Add game start time for duration tracking
        this.gameStartTime = null;

        // Initialize roleHistory with proper structure
        this.roleHistory = {
            seer: { investigations: [] },
            sorcerer: { investigations: [] },
            bodyguard: { protections: [] }
        };

        this.playerStateManager = new PlayerStateManager(this);

        // Add these properties to the WerewolfGame constructor
        this.readyPlayers = new Set();
        this.readyCheckTimeout = null;
        this.READY_CHECK_DURATION = 60000; // 1 minute

        this.requireDmCheck = false; // Default to false for easier testing

        this.rateLimiter = new RateLimiter();
        this.securityManager = new SecurityManager(guildId);
    }

    /**
     * Creates a snapshot of the current game state
     * @returns {Object} Complete snapshot of game state
     */
    createGameSnapshot() {
        return {
            phase: this.phase,
            players: new Map(Array.from(this.players.entries()).map(([id, player]) => [
                id,
                {
                    id: player.id,
                    isAlive: player.isAlive,
                    isProtected: player.isProtected,
                    role: player.role
                }
            ])),
            round: this.round,
            gameStartTime: this.gameStartTime,
            lastProtectedPlayer: this.lastProtectedPlayer,
            pendingHunterRevenge: this.pendingHunterRevenge,
            lovers: new Map(this.lovers),
            selectedRoles: new Map(this.selectedRoles),
            completedNightActions: new Set(this.completedNightActions),
            expectedNightActions: new Set(this.expectedNightActions),
            nightActions: { ...this.nightActions },
            roleHistory: {
                seer: { investigations: [...(this.roleHistory?.seer?.investigations || [])] },
                sorcerer: { investigations: [...(this.roleHistory?.sorcerer?.investigations || [])] },
                bodyguard: { protections: [...(this.roleHistory?.bodyguard?.protections || [])] }
            },
            readyPlayers: new Set(this.readyPlayers),
            requireDmCheck: this.requireDmCheck
        };
    }

    /**
     * Restores game state from a snapshot
     * @param {Object} snapshot - Game state snapshot to restore
     */
    async restoreFromSnapshot(snapshot) {
        this.phase = snapshot.phase;
        this.players = new Map(Array.from(snapshot.players.entries()).map(([id, playerData]) => [
            id,
            Object.assign(new Player(playerData.id, playerData.username, this.client), playerData)
        ]));
        this.round = snapshot.round;
        this.gameStartTime = snapshot.gameStartTime;
        this.lastProtectedPlayer = snapshot.lastProtectedPlayer;
        this.pendingHunterRevenge = snapshot.pendingHunterRevenge;
        this.lovers = new Map(snapshot.lovers);
        this.selectedRoles = new Map(snapshot.selectedRoles);
        this.completedNightActions = new Set(snapshot.completedNightActions);
        this.expectedNightActions = new Set(snapshot.expectedNightActions);
        this.nightActions = { ...snapshot.nightActions };
        this.roleHistory = {
            seer: { investigations: [...snapshot.roleHistory.seer.investigations] },
            sorcerer: { investigations: [...snapshot.roleHistory.sorcerer.investigations] },
            bodyguard: { protections: [...snapshot.roleHistory.bodyguard.protections] }
        };
        this.readyPlayers = new Set(snapshot.readyPlayers);
        this.requireDmCheck = snapshot.requireDmCheck;
    }

    /**
     * Adds a player to the game.
     * @param {User} user - Discord user object.
     * @returns {Player} - The added player.
     */
    async addPlayer(user) {
        const snapshot = this.createGameSnapshot();
        
        try {
            logger.info('Attempting to add player', { 
                userId: user.id, 
                currentPhase: this.phase,
                isLobby: this.phase === PHASES.LOBBY,
                requireDmCheck: this.requireDmCheck
            });
    
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
            }
    
            if (this.players.has(user.id)) {
                throw new GameError('Player already in game', 'You are already in the game.');
            }
    
            await this.rateLimiter.checkRateLimit(user.id, 'join');
    
            const sanitizedUsername = InputValidator.validateUsername(user.username);
            const validatedId = InputValidator.validateDiscordId(user.id);
            
            const player = new Player(validatedId, sanitizedUsername, this.client);
            this.players.set(user.id, player);
    
            if (!this.requireDmCheck) {
                const newReadyPlayers = new Set(this.readyPlayers);
                newReadyPlayers.add(user.id);
                this.readyPlayers = newReadyPlayers;  // Update atomically
                
                player.isReady = true;
                
                logger.info('Player auto-readied (DM checks disabled)', {
                    playerId: user.id,
                    username: user.username,
                    readyPlayers: Array.from(this.readyPlayers)
                });
            }
    
            await this.saveGameState();
            
            await this.updateReadyStatus();
    
            await this.securityManager.logAction(user.id, 'join');
    
            logger.info('Player added to the game', { 
                playerId: user.id, 
                username: user.username,
                currentPhase: this.phase,
                autoReady: !this.requireDmCheck,
                readyPlayers: Array.from(this.readyPlayers)
            });
    
            return player;
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error adding player to game', { error });
            throw error;
        }
    }

    /**
     * Starts the game after validating configurations.
     */
    async startGame() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Initial validations
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Game already started', 'The game has already started.');
            }
            if (this.players.size < MIN_PLAYERS) {
                throw new GameError('Not enough players', 'Not enough players to start the game. Minimum 6 players required.');
            }
    
            // Initialize state atomically
            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;
            this.gameStartTime = Date.now();
            this.roleHistory = {
                seer: { investigations: [] },
                sorcerer: { investigations: [] },
                bodyguard: { protections: [] }
            };
    
            // Save initial state
            await GameStateManager.saveGameState(this);
            
            logger.info('Game initialization complete', {
                phase: this.phase,
                playerCount: this.players.size,
                selectedRoles: Array.from(this.selectedRoles.entries())
            });
    
            try {
                // Assign roles - this is a critical operation
                await this.assignRoles();
                await GameStateManager.saveGameState(this);
    
                // Create channels - another critical operation
                await this.createPrivateChannels();
                await GameStateManager.saveGameState(this);
    
                // Send initial game message
                await this.broadcastMessage({
                    embeds: [{
                        color: 0x800000,
                        title: '🌕 Night Zero Begins 🐺',
                        description: 
                            '*The first night has begun. Special roles will receive their instructions via DM...*\n\n' +
                            'Night Zero will progress automatically once all actions are completed.',
                        footer: { text: 'May wisdom and strategy guide you...' }
                    }]
                });
    
                // Initialize Night Zero
                await this.nightActionProcessor.handleNightZero();
    
                logger.info('Game started successfully', {
                    phase: this.phase,
                    playerCount: this.players.size,
                    werewolfChannelId: this.werewolfChannel?.id,
                    deadChannelId: this.deadChannel?.id
                });
    
            } catch (error) {
                // If any critical operation fails, clean up channels directly
                try {
                    if (this.werewolfChannel) {
                        await this.werewolfChannel.delete()
                            .catch(error => {
                                if (error.code === 50001) { // Missing Access
                                    return this.werewolfChannel.delete({ force: true });
                                }
                                throw error;
                            });
                    }
                    if (this.deadChannel) {
                        await this.deadChannel.delete()
                            .catch(error => {
                                if (error.code === 50001) { // Missing Access
                                    return this.deadChannel.delete({ force: true });
                                }
                                throw error;
                            });
                    }
                } catch (channelError) {
                    logger.error('Error cleaning up channels after failed start', { channelError });
                }
                throw error; // Re-throw to trigger main error handler
            }
    
        } catch (error) {
            // Restore previous state and revert to LOBBY
            await this.restoreFromSnapshot(snapshot);
            this.phase = PHASES.LOBBY; // Ensure we're back in LOBBY phase
            await GameStateManager.saveGameState(this); // Save the reverted state
            
            logger.error('Error starting game', { 
                error,
                playerCount: this.players.size,
                selectedRoles: Array.from(this.selectedRoles.entries())
            });
            
            throw error;
        }
    }    /**
     * Assigns roles to all players based on selectedRoles configuration.
     */
    async assignRoles() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Get all players as an array
            const players = Array.from(this.players.values());
            const playerCount = players.length;
            
            logger.info('Starting role assignment', { 
                playerCount,
                selectedRoles: Array.from(this.selectedRoles.entries())
            });
            
            // Calculate roles array atomically
            const roleAssignments = this.calculateRoleAssignments(playerCount);
            
            // Validate role distribution before making any assignments
            if (roleAssignments.length !== playerCount) {
                throw new GameError(
                    'Role count mismatch', 
                    `Role count (${roleAssignments.length}) doesn't match player count (${playerCount})`
                );
            }

            // Shuffle roles
            const shuffledRoles = this.shuffleArray([...roleAssignments]);
            
            // Create temporary map for new role assignments
            const newRoleAssignments = new Map();
            
            // Assign roles atomically
            for (let i = 0; i < players.length; i++) {
                const player = players[i];
                const role = shuffledRoles[i];
                
                newRoleAssignments.set(player.id, {
                    playerId: player.id,
                    role: role,
                    username: player.username
                });
            }

            // Apply all role assignments atomically
            for (const [playerId, assignment] of newRoleAssignments) {
                const player = this.players.get(playerId);
                await player.assignRole(assignment.role);  // This will send the initial role card DM
                
                // If werewolf, prepare for werewolf channel access
                if (assignment.role === ROLES.WEREWOLF && this.werewolfChannel) {
                    await this.werewolfChannel.permissionOverwrites.create(playerId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }
            }

            // Save state after successful assignment
            await GameStateManager.saveGameState(this);

            logger.info('Roles assigned successfully', {
                playerCount,
                roleDistribution: shuffledRoles.reduce((acc, role) => {
                    acc[role] = (acc[role] || 0) + 1;
                    return acc;
                }, {})
            });

        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error in assignRoles', { 
                error: error.message,
                stack: error.stack,
                playerCount: this.players.size,
                selectedRoles: Array.from(this.selectedRoles.entries())
            });
            
            throw error;
        }
    }

/**
 * Calculates role assignments based on player count and selected roles
 * @param {number} playerCount - Number of players
 * @returns {string[]} Array of role assignments
 */
calculateRoleAssignments(playerCount) {
    const roles = [];
    
    // Add required roles first
    const werewolfCount = Math.max(1, Math.floor(playerCount / 4));
    roles.push(...Array(werewolfCount).fill(ROLES.WEREWOLF));
    roles.push(ROLES.SEER);

    // Add optional roles
    if (this.selectedRoles.get(ROLES.BODYGUARD)) roles.push(ROLES.BODYGUARD);
    if (this.selectedRoles.get(ROLES.CUPID)) roles.push(ROLES.CUPID);
    if (this.selectedRoles.get(ROLES.HUNTER)) roles.push(ROLES.HUNTER);
    if (this.selectedRoles.get(ROLES.MINION)) roles.push(ROLES.MINION);
    if (this.selectedRoles.get(ROLES.SORCERER)) roles.push(ROLES.SORCERER);

    // Validate werewolf team size
    const werewolfTeamSize = werewolfCount + 
        (this.selectedRoles.get(ROLES.MINION) ? 1 : 0) + 
        (this.selectedRoles.get(ROLES.SORCERER) ? 1 : 0);

    // NOTE: Using lenient calculation for testing purposes
    // For a more balanced game, use this stricter calculation:
    // const maxEvilTeamSize = Math.floor(playerCount / 4);  // 25% of players
    // OR for very strict balance:
    // const maxEvilTeamSize = Math.max(1, Math.floor((playerCount - 1) / 4));  // ~20% of players
    // Current lenient calculation allows up to 33% evil team size
    const maxEvilTeamSize = playerCount <= 4 ? 2 : Math.floor(playerCount / 3);
    
    if (werewolfTeamSize > maxEvilTeamSize) {
        throw new GameError(
            'Too many evil roles',
            'Too many werewolf-aligned roles selected for the player count. Remove some optional roles.'
        );
    }

    // Fill remaining slots with villagers
    const villagerCount = playerCount - roles.length;
    roles.push(...Array(villagerCount).fill(ROLES.VILLAGER));

    return roles;
}    /**
     * Shuffles an array using Fisher-Yates algorithm
     * @param {Array} array - Array to shuffle
     * @returns {Array} Shuffled array
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Creates private channels for werewolves and dead players.
     */
    async createPrivateChannels() {
        const snapshot = this.createGameSnapshot();
        const createdChannels = { dead: null, werewolf: null };
        
        try {
            const guild = await this.client.guilds.fetch(this.guildId);
            
            // Validate category ID
            const categoryId = process.env.WEREWOLF_CATEGORY_ID;
            if (!categoryId) {
                throw new GameError('Config Error', 'WEREWOLF_CATEGORY_ID not set in environment variables');
            }

            // Validate category exists
            const category = await guild.channels.fetch(categoryId);
            if (!category) {
                throw new GameError('Config Error', 'Could not find the specified category');
            }

            // Create both channels atomically
            try {
                // Create Dead channel
                createdChannels.dead = await guild.channels.create({
                    name: 'dead-players',
                    type: 0,
                    parent: categoryId,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: ['ViewChannel', 'SendMessages']
                        },
                        {
                            id: this.client.user.id,
                            allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                        }
                    ]
                });

                // Create Werewolf channel
                createdChannels.werewolf = await guild.channels.create({
                    name: 'werewolf-channel',
                    type: 0,
                    parent: categoryId,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: ['ViewChannel']
                        },
                        {
                            id: this.client.user.id,
                            allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                        }
                    ]
                });

                // Only update game state if both channels were created successfully
                this.deadChannel = createdChannels.dead;
                this.werewolfChannel = createdChannels.werewolf;

                // Add werewolves to the channel
                const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
                const permissionPromises = werewolves.map(werewolf => 
                    this.werewolfChannel.permissionOverwrites.create(werewolf.id, {
                        ViewChannel: true,
                        SendMessages: true
                    })
                );

                // Wait for all permission updates to complete
                await Promise.all(permissionPromises);

                // Save state after successful channel creation and permission setup
                await GameStateManager.saveGameState(this);

                logger.info('Private channels created successfully', {
                    categoryId,
                    werewolfChannelId: this.werewolfChannel.id,
                    deadChannelId: this.deadChannel.id,
                    werewolfCount: werewolves.length
                });

            } catch (error) {
                // If any part fails, clean up any channels that were created
                if (createdChannels.dead) {
                    await createdChannels.dead.delete().catch(err => 
                        logger.error('Error cleaning up dead channel', { err })
                    );
                }
                if (createdChannels.werewolf) {
                    await createdChannels.werewolf.delete().catch(err => 
                        logger.error('Error cleaning up werewolf channel', { err })
                    );
                }
                throw error;
            }

        } catch (error) {
            // Restore previous state
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error creating private channels', { 
                error: error.message,
                stack: error.stack,
                guildId: this.guildId,
                categoryId: process.env.WEREWOLF_CATEGORY_ID
            });
            
            throw new GameError(
                'Channel Creation Failed', 
                'Failed to create necessary channels. Make sure the bot has proper permissions and the category ID is correct.'
            );
        }
    }

       /**
     * Advances the game to the Night phase.
     */
       async advanceToNight() {
        const snapshot = this.createGameSnapshot();
        
        try {
            this.phase = PHASES.NIGHT;
            this.round++;
    
            // Clear any existing timeouts
            if (this.nominationTimeout) {
                clearTimeout(this.nominationTimeout);
                this.nominationTimeout = null;
            }
    
            // Save state before any external operations
            await GameStateManager.saveGameState(this);
    
            // Initialize night actions through processor
            // Remove the transition message from here since it's handled in handleNightActions
            await this.nightActionProcessor.handleNightActions();
    
            logger.info(`Game advanced to Night ${this.round}`, {
                phase: this.phase,
                round: this.round,
                playerCount: this.players.size,
                livingPlayers: this.getAlivePlayers().length
            });
    
        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error advancing to Night phase', { 
                error: error.message,
                stack: error.stack,
                currentPhase: this.phase,
                round: this.round
            });
            
            throw new GameError(
                'Phase Transition Failed',
                'Failed to advance to Night phase. The game state has been restored.'
            );
        }
    }

      /**
     * Moves a player to the Dead channel.
     * @param {Player} player - The player to move.
     */
      async moveToDeadChannel(player) {
        const snapshot = this.createGameSnapshot();
        
        try {
            if (!this.deadChannel) {
                logger.warn('Dead channel is not set');
                return;
            }
    
            // Group all permission changes to apply atomically
            const permissionUpdates = [
                // Add to dead channel
                this.deadChannel.permissionOverwrites.create(player.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                })
            ];
    
            // Remove from werewolf channel if applicable
            if (player.role === ROLES.WEREWOLF && this.werewolfChannel) {
                permissionUpdates.push(
                    this.werewolfChannel.permissionOverwrites.delete(player.id)
                );
            }
    
            // Apply all permission changes atomically
            await Promise.all(permissionUpdates);
    
            // Save state before external operations
            await GameStateManager.saveGameState(this);
    
            // Send notifications
            await Promise.all([
                this.deadChannel.send(`**${player.username}** has joined the dead chat.`),
                player.sendDM('You have died! You can now speak with other dead players in the #dead-players channel.')
            ]);
    
            logger.info('Player moved to Dead channel', { 
                playerId: player.id,
                wasWerewolf: player.role === ROLES.WEREWOLF 
            });
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error moving player to Dead channel', { 
                error: error.message,
                stack: error.stack,
                playerId: player.id 
            });
            throw error;
        }
    }

    /**
     * Broadcasts a message to the game channel.
     * @param {string|object} message - The message or embed to send.
     */
    async broadcastMessage(message) {
        const snapshot = this.createGameSnapshot();
        
        try {
            const channel = await this.client.channels.fetch(this.gameChannelId);
            if (!channel) {
                throw new GameError('Channel Not Found', 'The game channel does not exist.');
            }
    
            // Only sanitize string messages (user content), not our embeds
            if (typeof message === 'string') {
                message = InputValidator.sanitizeMessage(message);
            }
            // No need to sanitize embeds since they're created by our embedCreator
    
            await channel.send(message);
            
            logger.info('Broadcast message sent', { 
                messageType: typeof message === 'string' ? 'text' : 'embed',
                channelId: this.gameChannelId
            });
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error broadcasting message', { error });
            throw new GameError('Broadcast Failed', 'Failed to send message to game channel.');
        }
    }
    /**
     * Retrieves a single player by role.
     * @param {string} role - The role to search for.
     * @returns {Player|null} - The player with the specified role or null.
     */
    getPlayerByRole(role) {
        const player = Array.from(this.players.values()).find(
            (p) => p.role === role && p.isAlive
        );
        if (!player && role !== ROLES.CUPID) {
            logger.warn('No player found with role', { role });
            logger.info('Current players and their roles:', {
                players: Array.from(this.players.values()).map(p => `${p.username}: ${p.role}`)
            });
        }
        return player || null;
    }

    /**
     * Retrieves all players with a specific role.
     * @param {string} role - The role to search for.
     * @returns {Player[]} - Array of players with the specified role.
     */
    getPlayersByRole(role) {
        return Array.from(this.players.values()).filter(
            (player) => player.role === role && player.isAlive
        );
    }

    /**
     * Retrieves a player by their username.
     * @param {string} username - The username to search for.
     * @returns {Player|null} - The player with the specified username or null.
     */
    getPlayerByUsername(username) {
        return Array.from(this.players.values()).find(
            (player) => player.username.toLowerCase() === username.toLowerCase()
        ) || null;
    }

    /**
     * Retrieves all alive players.
     * @returns {Player[]} - Array of alive players.
     */
    getAlivePlayers() {
        return Array.from(this.players.values()).filter((player) => player.isAlive);
    }
    
    /**
     * Advances the game to the Day phase.
     */
    async advanceToDay() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Guard against multiple transitions
            if (this.phase === PHASES.DAY) {
                logger.warn('Already in Day phase, skipping transition');
                return;
            }

            // Validate current phase
            if (this.phase !== PHASES.NIGHT && this.phase !== PHASES.NIGHT_ZERO) {
                throw new GameError('Invalid phase transition', 
                    `Cannot transition to Day from ${this.phase}`);
            }

            // Update state atomically
            const stateUpdates = {
                phase: PHASES.DAY,
                // Reset voting state
                nominatedPlayer: null,
                nominator: null,
                seconder: null,
                votingOpen: false,
                votes: new Map(),
                // Reset night action state
                completedNightActions: new Set(),
                expectedNightActions: new Set(),
                nightActions: {},
                // Clear any protection
                lastProtectedPlayer: null
            };

            // Apply all state updates atomically
            Object.assign(this, stateUpdates);

            // Clear any existing timeouts
            if (this.nominationTimeout) {
                clearTimeout(this.nominationTimeout);
                this.nominationTimeout = null;
            }

            // Save state before any external operations
            await GameStateManager.saveGameState(this);

            // Send day transition message
            await this.broadcastMessage({
                embeds: [createDayTransitionEmbed()]
            });

            // Create day phase UI
            const channel = await this.client.channels.fetch(this.gameChannelId);
            await this.voteProcessor.createDayPhaseUI(channel, this.players);

            logger.info('Advanced to Day phase', {
                round: this.round,
                phase: this.phase,
                playerCount: this.players.size,
                livingPlayers: this.getAlivePlayers().length
            });

        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error advancing to Day phase', { 
                error: error.message,
                stack: error.stack,
                currentPhase: this.phase,
                round: this.round
            });
            
            throw new GameError(
                'Phase Transition Failed',
                'Failed to advance to Day phase. The game state has been restored.'
            );
        }
    }

    /**
     * Shuts down the game, cleaning up channels and resetting state.
     */
    async shutdownGame() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Clean up setup message if it exists
            if (this.setupMessageId) {
                try {
                    const channel = await this.client.channels.fetch(this.gameChannelId);
                    const setupMessage = await channel.messages.fetch(this.setupMessageId)
                        .catch(error => {
                            logger.warn('Could not fetch setup message', { error });
                            return null;
                        });
                    
                    if (setupMessage) {
                        await setupMessage.delete().catch(error => 
                            logger.warn('Could not delete setup message', { error })
                        );
                    }
                } catch (error) {
                    logger.warn('Error cleaning up setup message', { 
                        error,
                        setupMessageId: this.setupMessageId 
                    });
                }
            }
    
            // Clean up channels first - this is external and needs to happen before state changes
            await GameStateManager.cleanupChannels(this).catch(error => {
                logger.error('Error cleaning up channels during shutdown', { error });
            });
    
            // Clear any existing nomination first
            if (this.nominatedPlayer) {
                await this.voteProcessor.clearNomination('Game is ending.');
            }
    
            // Update state atomically
            const shutdownState = {
                // Reset all collections
                players: new Map(),
                votes: new Map(),
                nightActions: {},
                lovers: new Map(),
                selectedRoles: new Map(),
                completedNightActions: new Set(),
                expectedNightActions: new Set(),
    
                // Clear channels
                werewolfChannel: null,
                deadChannel: null,
    
                // Reset game state
                phase: PHASES.GAME_OVER,
                round: 0,
                gameOver: true,
                gameStartTime: null,
                lastProtectedPlayer: null,
                pendingHunterRevenge: null,
    
                // Clear voting state
                nominatedPlayer: null,
                nominator: null,
                seconder: null,
                votingOpen: false,
                nominationTimeout: null,
    
                // Reset role history
                roleHistory: {
                    seer: { investigations: [] },
                    sorcerer: { investigations: [] },
                    bodyguard: { protections: [] }
                }
            };
    
            // Clear intervals and timeouts
            if (this.stateSaveInterval) {
                clearInterval(this.stateSaveInterval);
                this.stateSaveInterval = null;
            }
            if (this.nominationTimeout) {
                clearTimeout(this.nominationTimeout);
                this.nominationTimeout = null;
            }
    
            // Apply shutdown state atomically
            Object.assign(this, shutdownState);
    
            // Save final state
            await GameStateManager.saveGameState(this);
    
            // Remove from client's games collection
            this.client.games.delete(this.guildId);
    
            // Clean up from database
            await Game.destroy({ 
                where: { guildId: this.guildId }
            });
    
            logger.info('Game shut down successfully', {
                guildId: this.guildId,
                gameChannelId: this.gameChannelId
            });
    
        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error shutting down game', { 
                error: error.message,
                stack: error.stack,
                guildId: this.guildId,
                phase: this.phase
            });
            
            // Even if restore fails, try emergency cleanup
            try {
                await GameStateManager.cleanupChannels(this);
                this.client.games.delete(this.guildId);
                await Game.destroy({ 
                    where: { guildId: this.guildId }
                });
            } catch (cleanupError) {
                logger.error('Emergency cleanup failed', { cleanupError });
            }
            
            throw error;
        }
    }

  
    /**
     * Adds a role to the selected roles configuration
     * @param {string} role - The role to add
     */
    async addRole(role) {
        const snapshot = this.createGameSnapshot();
        
        try {
            if (!ROLE_CONFIG[role]) {
                throw new GameError('Invalid role', `${role} is not a valid optional role.`);
            }
    
            const currentCount = this.selectedRoles.get(role) || 0;
            const maxCount = typeof ROLE_CONFIG[role].maxCount === 'function' 
                ? ROLE_CONFIG[role].maxCount(this.players.size)
                : ROLE_CONFIG[role].maxCount;
    
            if (currentCount >= maxCount) {
                throw new GameError('Role limit reached', `Cannot add more ${role} roles.`);
            }
    
            // Update state atomically
            this.selectedRoles.set(role, currentCount + 1);
            
            // Save state before external operations
            await GameStateManager.saveGameState(this);
    
            logger.info(`Added ${role} role`, { currentCount: currentCount + 1 });
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error adding role', { 
                error: error.message,
                stack: error.stack,
                role,
                currentCount: this.selectedRoles.get(role)
            });
            throw error;
        }
    }

    /**
     * Removes a role from the selected roles configuration
     * @param {string} role - The role to remove
     */
    async removeRole(role) {
        const snapshot = this.createGameSnapshot();
        
        try {
            const currentCount = this.selectedRoles.get(role) || 0;
            if (currentCount <= 0) {
                throw new GameError('No role to remove', `There are no ${role} roles to remove.`);
            }
    
            // Update state atomically
            const newCount = currentCount - 1;
            if (newCount === 0) {
                this.selectedRoles.delete(role);
            } else {
                this.selectedRoles.set(role, newCount);
            }
    
            // Save state before external operations
            await GameStateManager.saveGameState(this);
    
            logger.info(`Removed ${role} role`, { 
                oldCount: currentCount,
                newCount: this.selectedRoles.get(role) || 0 
            });
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error removing role', { 
                error: error.message,
                stack: error.stack,
                role,
                currentCount: this.selectedRoles.get(role)
            });
            throw error;
        }
    }

    /**
     * Cleans up and resets all game state.
     */
    async cleanup() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Clear all intervals and timeouts atomically
            const timers = {
                stateSaveInterval: this.stateSaveInterval,
                nominationTimeout: this.nominationTimeout,
                nightActionTimeout: this.nightActionTimeout
            };

            Object.entries(timers).forEach(([key, timer]) => {
                if (timer) {
                    if (key.includes('Interval')) {
                        clearInterval(timer);
                    } else {
                        clearTimeout(timer);
                    }
                }
            });

            // Create clean state object atomically
            const cleanState = {
                // Clear collections
                players: new Map(),
                votes: new Map(),
                nightActions: {},
                lovers: new Map(),
                selectedRoles: new Map(),
                completedNightActions: new Set(),
                expectedNightActions: new Set(),

                // Reset timers
                stateSaveInterval: null,
                nominationTimeout: null,
                nightActionTimeout: null,

                // Reset game state
                phase: PHASES.LOBBY,
                round: 0,
                gameOver: false,
                lastProtectedPlayer: null,
                pendingHunterRevenge: null,

                // Reset voting state
                nominatedPlayer: null,
                nominator: null,
                seconder: null,
                votingOpen: false,

                // Reset role history
                roleHistory: {
                    seer: { investigations: [] },
                    sorcerer: { investigations: [] },
                    bodyguard: { protections: [] }
                }
            };

            // Apply clean state atomically
            Object.assign(this, cleanState);

            // Save clean state
            await GameStateManager.saveGameState(this);

            logger.info('Game state cleaned up successfully', {
                phase: this.phase,
                gameOver: this.gameOver,
                collections: {
                    players: this.players.size,
                    votes: this.votes.size,
                    lovers: this.lovers.size,
                    selectedRoles: this.selectedRoles.size,
                    completedActions: this.completedNightActions.size,
                    expectedActions: this.expectedNightActions.size
                }
            });

        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error during cleanup', { 
                error: error.message,
                stack: error.stack,
                phase: this.phase,
                gameOver: this.gameOver
            });
            
            throw new GameError(
                'Cleanup Failed',
                'Failed to clean up game state. The game state has been restored.'
            );
        }
    }

     // Add this helper method to calculate game duration
    getGameDuration() {
        const now = Date.now();
        const gameStart = this.gameStartTime || now; // Add gameStartTime property in constructor
        const duration = now - gameStart;
        
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    /**
     * Updates player statistics after game end
     * @param {Set<Player>} winners - Set of winning players
     */
    async updatePlayerStats(winners) {
        const snapshot = this.createGameSnapshot();
        const updatedStats = new Map();
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000; // 1 second
    
        try {
            logger.info('Starting to update player stats', { 
                playerCount: this.players.size,
                winnerCount: winners.size,
                winners: Array.from(winners).map(p => ({
                    username: p.username,
                    role: p.role
                }))
            });
    
            // Retry wrapper function
            const retryOperation = async (operation, retries = MAX_RETRIES) => {
                try {
                    return await operation();
                } catch (error) {
                    if (retries > 0 && error.message.includes('SQLITE_BUSY')) {
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                        return retryOperation(operation, retries - 1);
                    }
                    throw error;
                }
            };
    
            // Process players in sequence rather than parallel
            for (const [playerId, player] of this.players) {
                const discordId = playerId.toString();
                const isWinner = Array.from(winners).some(w => w.id === player.id);
                
                try {
                    await retryOperation(async () => {
                        // Use a managed transaction
                        await PlayerStats.sequelize.transaction(async (t) => {
                            const [stats] = await PlayerStats.findOrCreate({
                                where: { discordId },
                                defaults: {
                                    username: player.username,
                                    gamesPlayed: 0,
                                    gamesWon: 0,
                                    // ... other defaults ...
                                },
                                transaction: t,
                                lock: true
                            });
    
                            // Update stats within transaction
                            await stats.increment('gamesPlayed', { transaction: t });
                            if (isWinner) {
                                await stats.increment('gamesWon', { transaction: t });
                            }
    
                            const roleField = `times${player.role.charAt(0).toUpperCase() + player.role.slice(1)}`;
                            await stats.increment(roleField, { transaction: t });
    
                            // Track successful update
                            updatedStats.set(discordId, {
                                username: player.username,
                                role: player.role,
                                isWinner
                            });
                        });
                    });
                } catch (playerError) {
                    logger.error('Error updating individual player stats', {
                        error: playerError,
                        playerId,
                        username: player.username
                    });
                    // Continue with other players even if one fails
                }
            }
    
            logger.info('Player stats updated successfully', {
                updatedPlayers: Array.from(updatedStats.entries()).map(([id, data]) => ({
                    id,
                    username: data.username,
                    role: data.role,
                    won: data.isWinner
                }))
            });
    
            // If we updated some but not all players, log a warning
            if (updatedStats.size < this.players.size) {
                logger.warn('Some player stats updates failed', {
                    totalPlayers: this.players.size,
                    successfulUpdates: updatedStats.size
                });
            }
    
            // Return true if we updated at least some players
            return updatedStats.size > 0;
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error updating player stats', { 
                error: error.message,
                stack: error.stack,
                successfulUpdates: Array.from(updatedStats.entries()).map(([id, data]) => ({
                    id,
                    username: data.username,
                    role: data.role
                }))
            });
            
            // Don't throw - just return false to indicate failure
            return false;
        }
    }

    getPhase() {
        return this.phase;
    }

    isInLobby() {
        return this.phase === PHASES.LOBBY;
    }

    // Add this method to the WerewolfGame class
    isGameCreatorOrAuthorized(userId) {
        return userId === this.gameCreatorId || this.authorizedIds.includes(userId);
    }

    // Add static create method
    static async create(client, guildId, channelId, creatorId) {
        try {
            logger.info('Creating new game instance', {
                guildId,
                channelId,
                creatorId
            });

            const game = new WerewolfGame(client, guildId, channelId, creatorId);
            client.games.set(guildId, game);
            await GameStateManager.saveGameState(game);

            logger.info('Game instance created successfully', {
                guildId,
                phase: game.phase
            });

            return game;
        } catch (error) {
            logger.error('Error in WerewolfGame.create', {
                error: error.message,
                stack: error.stack,
                guildId
            });
            throw error;
        }
    }

  
    /**
     * Checks win conditions to determine if the game should end.
     * @returns {boolean} - True if the game is over, else False.
     */
    async checkWinConditions() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Don't check win conditions during setup phases
            if (this.phase === PHASES.LOBBY || this.phase === PHASES.NIGHT_ZERO) {
                return false;
            }

            // If game is already over, don't check again
            if (this.gameOver) {
                return true;
            }

            // Get all living players
            const alivePlayers = this.getAlivePlayers();
            
            // Count living werewolves and villager team members
            const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
            const livingVillagerTeam = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF).length;

            let winners = new Set();
            let gameOver = false;

            // Calculate game stats atomically
            const gameStats = {
                rounds: this.round,
                totalPlayers: this.players.size,
                eliminations: this.players.size - alivePlayers.length,
                duration: this.getGameDuration(),
                players: Array.from(this.players.values())
            };

            // Determine win condition atomically
            if (alivePlayers.length === 0) {
                // Draw - no winners
                gameOver = true;
                this.phase = PHASES.GAME_OVER;
                this.gameOver = true;
            } 
            else if (livingWerewolves === 0) {
                // Village team wins
                gameOver = true;
                this.phase = PHASES.GAME_OVER;
                this.gameOver = true;
                
                // Add all non-evil team players to winners
                this.players.forEach(player => {
                    if (player.role !== ROLES.WEREWOLF && 
                        player.role !== ROLES.MINION && 
                        player.role !== ROLES.SORCERER) {
                        winners.add(player);
                    }
                });
            }
            else if (livingWerewolves >= livingVillagerTeam) {
                // Werewolf team wins
                gameOver = true;
                this.phase = PHASES.GAME_OVER;
                this.gameOver = true;
                
                // Add all evil team players to winners
                this.players.forEach(player => {
                    if (player.role === ROLES.WEREWOLF || 
                        player.role === ROLES.MINION || 
                        player.role === ROLES.SORCERER) {
                        winners.add(player);
                    }
                });
            }

            if (gameOver) {
                try {
                    // Clear all game state atomically
                    const endGameUpdates = {
                        nominatedPlayer: null,
                        nominator: null,
                        seconder: null,
                        votingOpen: false,
                        votes: new Map(),
                        nominationTimeout: null,
                        phase: PHASES.GAME_OVER,
                        gameOver: true
                    };

                    // Apply all end game updates atomically
                    Object.assign(this, endGameUpdates);

                    // Save state before external operations
                    await GameStateManager.saveGameState(this);

                    // Disable UI components
                    const channel = await this.client.channels.fetch(this.gameChannelId);
                    const messages = await channel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(message => {
                        if (message.components?.length > 0) {
                            return message.edit({ components: [] });
                        }
                    }));

                    // Send game end message
                    await this.broadcastMessage({
                        embeds: [createGameEndEmbed(Array.from(winners), gameStats)]
                    });

                    // Update player stats
                    await this.updatePlayerStats(winners);

                    // Clean up game resources
                    await this.shutdownGame();

                } catch (error) {
                    // If end game sequence fails, restore state and try cleanup
                    await this.restoreFromSnapshot(snapshot);
                    logger.error('Error in game end sequence', { 
                        error: error.message,
                        stack: error.stack 
                    });
                    await this.shutdownGame().catch(err => 
                        logger.error('Error in emergency shutdown', { err })
                    );
                }
            }

            return gameOver;

        } catch (error) {
            // Restore state on any error
            await this.restoreFromSnapshot(snapshot);
            
            logger.error('Error checking win conditions', { 
                error: error.message,
                stack: error.stack,
                phase: this.phase,
                round: this.round
            });
            
            throw error;
        }
    }

    /**
     * Saves the current game state
     */
    async saveGameState() {
        try {
            await GameStateManager.saveGameState(this);
        } catch (error) {
            logger.error('Error saving game state', { 
                error: error.message,
                stack: error.stack,
                phase: this.phase,
                round: this.round
            });
            throw error;
        }
    }

    /**
     * Creates and stores the initial game setup message
     * @param {TextChannel} channel - Discord channel to send message to
     * @returns {Message} The created setup message
     */
    async createInitialMessage(channel) {
        try {
            const setupMessage = await channel.send({
                embeds: [createGameWelcomeEmbed()],
                components: createGameSetupButtons()
            });
            
            this.setupMessageId = setupMessage.id;
            await this.saveGameState();
            
            logger.info('Created initial game setup message', {
                messageId: setupMessage.id,
                channelId: channel.id
            });

            return setupMessage;
        } catch (error) {
            logger.error('Error creating initial game message', { error });
            throw error;
        }
    }

    // Add this new method to WerewolfGame class
    async handleHunterRevenge(hunter) {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Set pending revenge state
            this.pendingHunterRevenge = hunter.id;
            
            // First announce the tension
            await this.broadcastMessage({
                embeds: [createHunterTensionEmbed(hunter)]
            });
    
            // Create dropdown for Hunter's revenge
            const validTargets = Array.from(this.players.values())
                .filter(p => p.isAlive && p.id !== hunter.id)
                .map(p => ({
                    label: p.username,
                    value: p.id,
                    description: `Take ${p.username} with you`
                }));
    
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('hunter_revenge')
                .setPlaceholder('Choose your target')
                .addOptions(validTargets);
    
            const row = new ActionRowBuilder().addComponents(selectMenu);
    
            logger.info('Setting up Hunter revenge', {
                hunterId: hunter.id,
                hunterName: hunter.username,
                validTargetCount: validTargets.length
            });
    
            // Save state before sending DM
            await this.saveGameState();
    
            // Try to send DM to Hunter
            try {
                const dmResult = await hunter.sendDM({
                    embeds: [createHunterRevengePromptEmbed()],
                    components: [row]
                });
    
                logger.info('Hunter revenge DM sent', {
                    hunterId: hunter.id,
                    hunterName: hunter.username,
                    dmResult: !!dmResult
                });
    
            } catch (dmError) {
                logger.error('Failed to send Hunter revenge DM', {
                    error: {
                        name: dmError.name,
                        message: dmError.message,
                        code: dmError.code,
                        stack: dmError.stack
                    },
                    hunterId: hunter.id,
                    hunterName: hunter.username
                });
    
                // Send fallback message to main channel using embedCreator
                await this.broadcastMessage({
                    embeds: [createHunterRevengeFallbackEmbed(hunter.username)]
                });
            }
    
        } catch (error) {
            // Restore previous state on error
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error in handleHunterRevenge', { 
                error: {
                    name: error.name,
                    message: error.message,
                    code: error.code,
                    stack: error.stack
                },
                hunterId: hunter.id,
                hunterName: hunter.username
            });
            throw error;
        }
    }

    /**
     * Processes Hunter's revenge action
     * @param {string} hunterId - ID of the Hunter
     * @param {string} targetId - ID of the revenge target
     */
    async processHunterRevenge(hunterId, targetId) {
        const snapshot = this.createGameSnapshot();
        
        try {
            const hunter = this.players.get(hunterId);
            const target = this.players.get(targetId);

            if (!this.pendingHunterRevenge || hunterId !== this.pendingHunterRevenge) {
                throw new GameError('Invalid action', 'No pending Hunter revenge action.');
            }

            if (!target?.isAlive) {
                throw new GameError('Invalid target', 'Target must be alive.');
            }

            // Send revenge announcement
            await this.broadcastMessage({
                embeds: [createHunterRevengeEmbed(hunter, target)]
            });

            // Kill the target using PlayerStateManager
            await this.playerStateManager.changePlayerState(targetId, 
                { isAlive: false },
                { 
                    reason: 'Hunter revenge target',
                    skipHunterRevenge: true, // Prevent infinite loop if target is also Hunter
                    announceImmediately: true
                }
            );

            // Clear pending revenge state
            this.pendingHunterRevenge = null;

            // Save state
            await this.saveGameState();

            logger.info('Hunter revenge processed', {
                hunterId: hunter.id,
                targetId: target.id,
                currentPhase: this.phase
            });

            // Check win conditions and advance phase appropriately
            if (!this.checkWinConditions()) {
                // Advance to opposite phase of when Hunter died
                if (this.phase === PHASES.NIGHT) {
                    await this.advanceToDay();
                } else {
                    await this.advanceToNight();
                }
            }

        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error processing Hunter revenge', { error });
            throw error;
        }
    }

    // Add this method to handle ready checks
    async handleReadyCheck(playerId) {
        const snapshot = this.createGameSnapshot();
        
        try {
            const player = this.players.get(playerId);
            if (!player) {
                throw new GameError('Not in game', 'You must join the game first.');
            }
    
            // If DM checks are disabled, clicking Ready should do nothing
            if (!this.requireDmCheck) {
                logger.info('Ready button clicked but DM checks disabled - ignoring', {
                    playerId,
                    requireDmCheck: this.requireDmCheck
                });
                return;
            }
    
            // Create new ready players set atomically
            const newReadyPlayers = new Set(this.readyPlayers);
            
            if (newReadyPlayers.has(playerId)) {
                // If already ready, unready them
                newReadyPlayers.delete(playerId);
                player.isReady = false;
                logger.info('Player unreadied', { 
                    playerId,
                    requireDmCheck: this.requireDmCheck 
                });
            } else {
                // Try DM check since it's required
                try {
                    await player.sendDM({
                        embeds: [{
                            color: 0x00ff00,
                            title: '✅ DM Test Successful',
                            description: 'You can receive direct messages from the bot.'
                        }]
                    });
                    newReadyPlayers.add(playerId);
                    player.isReady = true;
                    logger.info('Player readied after DM check', { 
                        playerId,
                        requireDmCheck: this.requireDmCheck 
                    });
                } catch (error) {
                    throw new GameError(
                        'DM Failed',
                        'Please enable DMs from server members to play.'
                    );
                }
            }
    
            // Update state atomically
            this.readyPlayers = newReadyPlayers;
            
            // Save state before UI update
            await this.saveGameState();
            
            // Update UI after state is saved
            await this.updateReadyStatus();
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            throw error;
        }
    }

    // Add this method to update ready status display
    async updateReadyStatus() {
        const channel = await this.client.channels.fetch(this.gameChannelId);
        const setupMessage = await channel.messages.fetch(this.setupMessageId);
    
        const joinedPlayers = Array.from(this.players.values());
        const readyPlayers = joinedPlayers.filter(p => this.readyPlayers.has(p.id));
        const unreadyPlayers = joinedPlayers.filter(p => !this.readyPlayers.has(p.id));
    
        logger.info('Updating ready status', {
            totalPlayers: joinedPlayers.length,
            readyCount: readyPlayers.length,
            unreadyCount: unreadyPlayers.length,
            readyPlayerIds: Array.from(this.readyPlayers),
            requireDmCheck: this.requireDmCheck
        });
    
        const embed = createGameWelcomeEmbed(
            readyPlayers.length,
            joinedPlayers.length,
            this.requireDmCheck
        );
    
        // Add ready players list with checkmark
        if (readyPlayers.length > 0) {
            embed.fields.push({
                name: `✅ Ready to Play (${readyPlayers.length})`,
                value: readyPlayers.map(p => `• ${p.username}`).join('\n'),
                inline: false
            });
        }
    
        // Add game status
        const canStart = joinedPlayers.length >= MIN_PLAYERS && readyPlayers.length === joinedPlayers.length;
        embed.fields.push({
            name: '📊 Game Status',
            value: `${readyPlayers.length}/${joinedPlayers.length} players ready\n${canStart ? 'Ready to start!' : ''}`,
            inline: false
        });
    
        await setupMessage.edit({
            embeds: [embed],
            components: createGameSetupButtons(this.selectedRoles, this.requireDmCheck)
        });
    }

    // Add this method to toggle DM check requirement
    async toggleDmCheck() {
        const snapshot = this.createGameSnapshot();
        
        try {
            // Create new state atomically
            const newRequireDmCheck = !this.requireDmCheck;
            let newReadyPlayers = new Set(this.readyPlayers); // Keep existing ready players
    
            // If turning DM checks OFF, auto-ready ALL current players
            if (!newRequireDmCheck) {
                for (const playerId of this.players.keys()) {
                    newReadyPlayers.add(playerId);
                }
            }
            // If turning DM checks ON, clear ready status
            else {
                newReadyPlayers.clear();
            }
            
            // Apply state changes atomically
            this.requireDmCheck = newRequireDmCheck;
            this.readyPlayers = newReadyPlayers;
            
            // Save state before UI update
            await this.saveGameState();
            
            // Update UI after state is saved
            await this.updateReadyStatus();
            
            logger.info('DM check requirement toggled', { 
                requireDmCheck: this.requireDmCheck,
                readyPlayersCount: this.readyPlayers.size,
                totalPlayers: this.players.size,
                readyPlayers: Array.from(this.readyPlayers)
            });
            
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            throw error;
        }
    }
};

module.exports = WerewolfGame;

