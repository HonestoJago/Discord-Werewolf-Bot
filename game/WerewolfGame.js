// game/WerewolfGame.js

const Player = require('./Player');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');  // Direct import of frozen object
const PHASES = require('../constants/phases'); // Direct import of frozen object
const { createDayPhaseEmbed, createVoteResultsEmbed, createGameEndEmbed } = require('../utils/embedCreator');
const NightActionProcessor = require('./NightActionProcessor');
const VoteProcessor = require('./VoteProcessor');
const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const PlayerStats = require('../models/Player');
const Game = require('../models/Game');
const { createGameEndButtons } = require('../utils/buttonCreator');
const GameStateManager = require('../utils/gameStateManager');

// Define roles and their properties in a configuration object
const ROLE_CONFIG = {
    [ROLES.WEREWOLF]: { maxCount: (playerCount) => Math.max(1, Math.floor(playerCount / 4)) },
    [ROLES.SEER]: { maxCount: 1 },
    [ROLES.BODYGUARD]: { maxCount: 1 },
    [ROLES.CUPID]: { maxCount: 1 },
    [ROLES.HUNTER]: { maxCount: 1 },
    [ROLES.VILLAGER]: { maxCount: (playerCount) => playerCount }
};

const PHASE_TRANSITIONS = {
    [PHASES.LOBBY]: ['NIGHT_ZERO'],
    [PHASES.NIGHT_ZERO]: ['DAY'],
    [PHASES.DAY]: ['NIGHT', 'GAME_OVER'],
    [PHASES.NIGHT]: ['DAY', 'GAME_OVER'],
    [PHASES.GAME_OVER]: []
};

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
                await this.saveGameState();
            } catch (error) {
                logger.error('Error in periodic state save', { error });
            }
        }, 5 * 60 * 1000); // Save every 5 minutes

        // Add game start time for duration tracking
        this.gameStartTime = null;
    }

    /**
     * Adds a player to the game.
     * @param {User} user - Discord user object.
     * @returns {Player} - The added player.
     */
    async addPlayer(user) {
        logger.info('Adding player', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY 
        });
        
        if (this.phase !== PHASES.LOBBY) {
            throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
        }

        try {
            logger.info('Attempting to add player', { 
                userId: user.id, 
                currentPhase: this.phase,
                isLobby: this.phase === PHASES.LOBBY 
            });

            // Synchronize addition to prevent race conditions
            if (this.players.has(user.id)) {
                throw new GameError('Player already in game', 'You are already in the game.');
            }

            const player = new Player(user.id, user.username, this.client);
            this.players.set(user.id, player);

            // Save game state after adding player
            await this.saveGameState();
            logger.info('Player added to the game', { 
                playerId: user.id, 
                username: user.username,
                currentPhase: this.phase 
            });
            return player;
        } catch (error) {
            logger.error('Error adding player to game', { 
                error, 
                userId: user.id,
                currentPhase: this.phase 
            });
            throw error;
        }
    }

    /**
     * Starts the game after validating configurations.
     */
    async startGame() {
        try {
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Game already started', 'The game has already started.');
            }
            if (this.players.size < 4) {
                throw new GameError('Not enough players', 'Not enough players to start the game. Minimum 4 players required.');
            }
    
            // Initialize selectedRoles if not exists
            if (!this.selectedRoles) {
                this.selectedRoles = new Map();
            }
    
            // Set phase BEFORE role assignment
            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;
            this.gameStartTime = Date.now();
    
            // Assign roles and create channels
            await this.assignRoles();
            await this.createPrivateChannels();
    
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
    
            // Initialize Night Zero - this will handle Seer's vision and Cupid's action
            await this.nightActionProcessor.handleNightZero();
    
            logger.info('Game started successfully');
        } catch (error) {
            // Reset phase if anything fails
            this.phase = PHASES.LOBBY;
            logger.error('Error starting game', { error });
            throw error;
        }
    }

    /**
     * Assigns roles to all players based on selectedRoles configuration.
     */
    async assignRoles() {
        try {
            // Get all players as an array
            const players = Array.from(this.players.values());
            const playerCount = players.length;
            
            logger.info('Starting role assignment', { 
                playerCount,
                selectedRoles: Array.from(this.selectedRoles.entries())
            });
            
            // Create array of roles based on selectedRoles
            let roles = [];
            
            // Add werewolves
            const werewolfCount = Math.max(1, Math.floor(playerCount / 4));
            roles.push(...Array(werewolfCount).fill(ROLES.WEREWOLF));
            
            // Add one seer
            roles.push(ROLES.SEER);
    
            // Add optional roles if they were selected
            if (this.selectedRoles.get(ROLES.BODYGUARD)) {
                roles.push(ROLES.BODYGUARD);
            }
            if (this.selectedRoles.get(ROLES.CUPID)) {
                roles.push(ROLES.CUPID);
            }
            if (this.selectedRoles.get(ROLES.HUNTER)) {
                roles.push(ROLES.HUNTER);
            }
            
            // Validate total roles before adding villagers
            if (roles.length > playerCount) {
                throw new GameError(
                    'Too many roles', 
                    `Cannot start game: ${roles.length} roles selected for ${playerCount} players. ` +
                    'Please remove some optional roles.'
                );
            }
            
            // Fill remaining slots with villagers
            const villagerCount = playerCount - roles.length;
            roles.push(...Array(villagerCount).fill(ROLES.VILLAGER));
            
            // Log roles before shuffling
            logger.info('Roles before assignment', { 
                roles,
                playerCount,
                werewolfCount,
                villagerCount
            });
            
            // Shuffle roles
            for (let i = roles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [roles[i], roles[j]] = [roles[j], roles[i]];
            }
            
            // Assign roles to players
            for (let i = 0; i < players.length; i++) {
                const player = players[i];
                const role = roles[i];
                
                // Log before assignment
                logger.info('Assigning role', { 
                    playerId: player.id, 
                    playerName: player.username, 
                    role: role 
                });
                
                await player.assignRole(role);
                
                // If werewolf, add to werewolf channel
                if (role === ROLES.WEREWOLF && this.werewolfChannel) {
                    await this.werewolfChannel.permissionOverwrites.create(player.id, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }
            }
            
            logger.info('Roles assigned successfully', {
                playerCount,
                werewolfCount,
                roles: roles.reduce((acc, role) => {
                    acc[role] = (acc[role] || 0) + 1;
                    return acc;
                }, {})
            });
            
        } catch (error) {
            logger.error('Error in assignRoles', { 
                error: error.message,
                stack: error.stack,
                players: Array.from(this.players.values()).map(p => ({
                    id: p.id,
                    username: p.username
                }))
            });
            throw error;
        }
    }

    /**
     * Creates private channels for werewolves and dead players.
     */
    async createPrivateChannels() {
        try {
            const guild = await this.client.guilds.fetch(this.guildId);
            const gameChannel = await guild.channels.fetch(this.gameChannelId);
            
            // Get category ID from environment variables
            const categoryId = process.env.WEREWOLF_CATEGORY_ID;
            if (!categoryId) {
                throw new GameError('Config Error', 'WEREWOLF_CATEGORY_ID not set in environment variables');
            }

            // Fetch the category
            const category = await guild.channels.fetch(categoryId);
            if (!category) {
                throw new GameError('Config Error', 'Could not find the specified category');
            }

            // Create Dead channel with default permissions denying view access
            this.deadChannel = await guild.channels.create({
                name: 'dead-players',
                type: 0,  // 0 is text channel
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel', 'SendMessages']  // Everyone can't see or send by default
                    },
                    {
                        id: this.client.user.id,
                        allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                    }
                ]
            });

            // Create Werewolf channel
            this.werewolfChannel = await guild.channels.create({
                name: 'werewolf-channel',
                type: 0,  // 0 is text channel
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

            // Add werewolves to the channel after creation
            const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
            for (const werewolf of werewolves) {
                await this.werewolfChannel.permissionOverwrites.create(werewolf.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            logger.info('Private channels created successfully', {
                categoryId,
                werewolfChannelId: this.werewolfChannel.id,
                deadChannelId: this.deadChannel.id
            });
        } catch (error) {
            logger.error('Error creating private channels', { error });
            throw new GameError('Channel Creation Failed', 'Failed to create necessary channels. Make sure the bot has proper permissions and the category ID is correct.');
        }
    }

    /**
     * Handles Night Zero phase where initial actions occur.
     */
    async nightZero() {
        try {
            // Get werewolves and send them their team info
            const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
            const werewolfNames = werewolves.map(w => w.username).join(', ');
            for (const werewolf of werewolves) {
                await werewolf.sendDM(`Your fellow werewolves are: ${werewolfNames}`);
            }

            // Handle Seer's initial revelation
            const seer = this.getPlayerByRole(ROLES.SEER);
            if (seer && seer.isAlive) {
                const validTargets = Array.from(this.players.values()).filter(
                    p => p.role !== ROLES.WEREWOLF && 
                         p.id !== seer.id && 
                         p.isAlive
                );
                
                if (validTargets.length > 0) {
                    const randomPlayer = validTargets[Math.floor(Math.random() * validTargets.length)];
                    await seer.sendDM(`You have been shown that **${randomPlayer.username}** is **Not a Werewolf**.`);
                }
            }

            // Handle Cupid's action if present
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (cupid && cupid.isAlive) {
                // Prompt Cupid to choose lovers via DM
                await cupid.sendDM('Use `/action choose_lovers` to select two players as lovers. You have 10 minutes.');
                this.expectedNightActions.add(cupid.id);
                
                // Set timeout for Cupid's action
                this.nightActionTimeout = setTimeout(async () => {
                    try {
                        if (this.expectedNightActions.has(cupid.id)) {
                            await cupid.sendDM('Time is up! You did not choose lovers in time.');
                            this.expectedNightActions.delete(cupid.id);
                            await this.finishNightZero();
                        }
                    } catch (error) {
                        logger.error('Error handling Cupid timeout during Night Zero', { error });
                    }
                }, 600000); // 10 minutes
            } else {
                // No Cupid present, proceed to Day phase after brief delay
                setTimeout(async () => {
                    try {
                        await this.finishNightZero();
                    } catch (error) {
                        logger.error('Error advancing to Day phase after Night Zero', { error: error.stack });
                        throw error;
                    }
                }, 2000); // 2 seconds delay to ensure all messages are sent
            }

            logger.info('Night Zero started');
        } catch (error) {
            logger.error('Error during Night Zero', { error: error.stack });
            throw error;
        }
    }

    /**
     * Completes Night Zero and transitions to Day phase.
     */
    async finishNightZero() {
        try {
            // Clear any remaining Night Zero actions
            this.expectedNightActions.clear();
            this.nightActions = {};

            // Transition to Day phase
            this.phase = PHASES.DAY;
            this.round = 1; // Start first day

            // Create Day phase UI
            const channel = await this.client.channels.fetch(this.gameChannelId);
            await dayPhaseHandler.createDayPhaseUI(channel, this.players);

            // Save state after transition
            await this.saveGameState();

            logger.info('Transitioned to Day phase from Night Zero', { 
                phase: this.phase, 
                round: this.round 
            });
        } catch (error) {
            logger.error('Error finishing Night Zero', { error });
            throw error;
        }
    }

    /**
     * Advances the game to the Night phase.
     */
    async advanceToNight() {
        try {
            // Guard against multiple transitions
            if (this.phase === PHASES.NIGHT) {
                logger.warn('Already in Night phase, skipping transition');
                return;
            }
    
            // Directly reset nomination state WITHOUT calling clearNomination
            this.nominatedPlayer = null;
            this.nominator = null;
            this.seconder = null;
            this.votingOpen = false;
            this.votes.clear();
            if (this.nominationTimeout) {
                clearTimeout(this.nominationTimeout);
                this.nominationTimeout = null;
            }
    
            // Set phase first
            this.phase = PHASES.NIGHT;
            this.round += 1;
            
            // Reset night action tracking
            this.completedNightActions.clear();
            this.expectedNightActions.clear();
            this.nightActions = {};

            // Save state after all changes
            await this.saveGameState();

            // Delegate night action handling to NightActionProcessor
            await this.nightActionProcessor.handleNightActions();

            logger.info(`Game advanced to Night ${this.round}`, {
                phase: this.phase,
                round: this.round,
                stateAfterSave: await Game.findByPk(this.guildId) // Add this to verify state
            });

        } catch (error) {
            logger.error('Error advancing to Night phase', { error, stack: error.stack });
            throw error;
        }
    }

    /**
     * Completes the current phase and transitions automatically or relies on manual advance.
     */
    async completePhase() {
        try {
            switch (this.phase) {
                case PHASES.DAY:
                    await this.advanceToNight();
                    break;
                case PHASES.NIGHT:
                    await this.advanceToDay();
                    break;
                default:
                    logger.warn('Attempted to complete an unhandled phase:', { phase: this.phase });
            }
        } catch (error) {
            logger.error('Error in completePhase', { error });
            throw error;
        }
    }

    /**
     * Moves a player to the Dead channel.
     * @param {Player} player - The player to move.
     */
    async moveToDeadChannel(player) {
        try {
            if (!this.deadChannel) {
                logger.warn('Dead channel is not set');
                return;
            }
    
            // Add to dead channel
            await this.deadChannel.permissionOverwrites.create(player.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
    
            // If player was a werewolf, remove them from werewolf channel
            if (player.role === ROLES.WEREWOLF && this.werewolfChannel) {
                await this.werewolfChannel.permissionOverwrites.delete(player.id);
                logger.info('Removed dead werewolf from werewolf channel', { 
                    playerId: player.id,
                    username: player.username 
                });
            }
    
            await this.deadChannel.send(`**${player.username}** has joined the dead chat.`);
            await player.sendDM('You have died! You can now speak with other dead players in the #dead-players channel.');
            
            logger.info('Player moved to Dead channel', { playerId: player.id });
        } catch (error) {
            logger.error('Error moving player to Dead channel', { error, playerId: player.id });
        }
    }

    /**
     * Broadcasts a message to the game channel.
     * @param {string|object} message - The message or embed to send.
     */
    async broadcastMessage(message) {
        try {
            const channel = await this.client.channels.fetch(this.gameChannelId);
            if (!channel) {
                logger.error('Game channel not found', { gameChannelId: this.gameChannelId });
                throw new GameError('Channel Not Found', 'The game channel does not exist.');
            }
            await channel.send(message);
            logger.info('Broadcast message sent', { message: typeof message === 'string' ? message : 'Embed object' });
        } catch (error) {
            logger.error('Error broadcasting message', { error });
            // Throw wrapped error to allow proper handling
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
     * Completes the Night phase and transitions to Day phase.
     */
    async advanceToDay() {
        try {
            // Guard against multiple transitions
            if (this.phase === PHASES.DAY) {
                logger.warn('Already in Day phase, skipping transition');
                return;
            }

            // Set phase first
            this.phase = PHASES.DAY;
            this.round += 1; // Increment round if necessary

            await this.broadcastMessage({
                embeds: [{
                    color: 0xFFA500,
                    title: '☀️ Dawn Breaks Over the Village',
                    description: 
                        '*The morning sun reveals the events of the Night...*\n\n' +
                        'The game progresses to the Day phase. Discuss and find the werewolves!',
                    footer: { text: 'Debate wisely, for a wrong accusation could doom the village.' }
                }]
            });

            // Create Day phase UI for new nominations
            const channel = await this.client.channels.fetch(this.gameChannelId);
            await dayPhaseHandler.createDayPhaseUI(channel, this.players);

            // Save state after transition
            await this.saveGameState();

            logger.info('Transitioned to Day phase', { 
                phase: this.phase, 
                round: this.round 
            });
        } catch (error) {
            logger.error('Error advancing to Day phase', { error });
            throw error;
        }
    }

    /**
     * Shuts down the game, cleaning up channels and resetting state.
     */
    async shutdownGame() {
        // Clear any existing nomination before shutting down
        if (this.nominatedPlayer) {
            await this.voteProcessor.clearNomination('Game is ending.');
        }
        try {
            await this.cleanupChannels();
            this.players.forEach(player => player.reset());
            this.phase = PHASES.LOBBY;
            this.round = 0;
            this.votes.clear();
            this.nightActions = {};
            this.lovers.clear();
            this.selectedRoles.clear();
            this.gameOver = false;
            this.lastProtectedPlayer = null;
            this.pendingHunterRevenge = null;
            this.nominatedPlayer = null;
            this.nominator = null;
            this.seconder = null;
            this.votingOpen = false;

            // Clear game start time
            this.gameStartTime = null;

            logger.info('Game has been shut down and reset');
        } catch (error) {
            logger.error('Error shutting down the game', { error });
            throw error;
        }
    }

    /**
     * Cleans up private channels after the game ends.
     */
    async cleanupChannels() {
        try {
            if (this.werewolfChannel) {
                try {
                    await this.werewolfChannel.delete();
                    logger.info('Werewolf channel deleted successfully');
                } catch (error) {
                    logger.error('Error deleting werewolf channel', { error });
                }
            }

            if (this.deadChannel) {
                try {
                    await this.deadChannel.delete();
                    logger.info('Dead channel deleted successfully');
                } catch (error) {
                    logger.error('Error deleting dead channel', { error });
                }
            }

            // Clear the references
            this.werewolfChannel = null;
            this.deadChannel = null;
        } catch (error) {
            logger.error('Error in cleanupChannels', { error });
            throw error;
        }
    }

    /**
     * Adds a role to the selected roles configuration
     * @param {string} role - The role to add
     */
    addRole(role) {
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

        this.selectedRoles.set(role, currentCount + 1);
        logger.info(`Added ${role} role`, { currentCount: currentCount + 1 });
    }

    /**
     * Removes a role from the selected roles configuration
     * @param {string} role - The role to remove
     */
    removeRole(role) {
        const currentCount = this.selectedRoles.get(role) || 0;
        if (currentCount <= 0) {
            throw new GameError('No role to remove', `There are no ${role} roles to remove.`);
        }

        this.selectedRoles.set(role, currentCount - 1);
        if (this.selectedRoles.get(role) === 0) {
            this.selectedRoles.delete(role);
        }
        logger.info(`Removed ${role} role`, { currentCount: currentCount - 1 });
    }

    cleanup() {
        // Clear any intervals
        if (this.stateSaveInterval) {
            clearInterval(this.stateSaveInterval);
            this.stateSaveInterval = null;
        }

        // Clear any timeouts
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
            this.nominationTimeout = null;
        }

        if (this.nightActionTimeout) {
            clearTimeout(this.nightActionTimeout);
            this.nightActionTimeout = null;
        }

        // Clear game state
        this.players.clear();
        this.votes.clear();
        this.nightActions = {};
        this.lovers.clear();
        this.selectedRoles.clear();
        this.completedNightActions.clear();
        this.expectedNightActions.clear();

        // Reset other properties
        this.phase = PHASES.LOBBY;
        this.round = 0;
        this.gameOver = false;
        this.lastProtectedPlayer = null;
        this.pendingHunterRevenge = null;
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votingOpen = false;
    }

    async checkWinConditions() {
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
        
        // Count living werewolves
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        
        // Count living villager team (everyone who's not a werewolf)
        const livingVillagerTeam = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF).length;
    
        let winners = new Set();
        let gameOver = false;
    
        // Calculate game stats
        const gameStats = {
            rounds: this.round,
            totalPlayers: this.players.size,
            eliminations: this.players.size - alivePlayers.length,
            duration: this.getGameDuration(),
            players: Array.from(this.players.values())
        };
    
        // If all werewolves are dead, villagers win
        if (livingWerewolves === 0) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all non-werewolf players (including dead ones) to winners
            this.players.forEach(player => {
                if (player.role !== ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
    
            // Log victory condition
            logger.info('Village victory achieved', {
                livingVillagers: livingVillagerTeam,
                totalWinners: winners.size
            });
        }
    
        // If werewolves reach parity with or outnumber villager team, werewolves win
        if (livingWerewolves >= livingVillagerTeam) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all werewolf players (including dead ones) to winners
            this.players.forEach(player => {
                if (player.role === ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
    
            // Log victory condition
            logger.info('Werewolf victory achieved', {
                livingWerewolves,
                livingVillagers: livingVillagerTeam,
                totalWinners: winners.size
            });
        }
    
        if (gameOver) {
            try {
                // Try to find and disable any active voting messages
                const channel = await this.client.channels.fetch(this.gameChannelId);
                const messages = await channel.messages.fetch({ limit: 10 });
                for (const message of messages.values()) {
                    if (message.components?.length > 0) {
                        await message.edit({ components: [] });
                    }
                }
            } catch (error) {
                logger.warn('Could not disable voting buttons', { error });
            }

            // Send game end message
            await this.broadcastMessage({
                embeds: [createGameEndEmbed(Array.from(winners), gameStats)]
            });
    
            // Update player stats with correct winners
            await this.updatePlayerStats(winners);
    
            // Clean up the game
            await this.shutdownGame();
            this.client.games.delete(this.guildId);
            await Game.destroy({ where: { guildId: this.guildId } });
        }
    
        return gameOver;
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

    async updatePlayerStats(winners) {
        try {
            logger.info('Starting to update player stats', { 
                playerCount: this.players.size,
                winnerCount: winners.size,
                winners: Array.from(winners).map(p => ({
                    username: p.username,
                    role: p.role
                }))
            });
    
            for (const [playerId, player] of this.players) {
                try {
                    const discordId = playerId.toString();
                    let stats = await PlayerStats.findByPk(discordId);
                    if (!stats) {
                        stats = await PlayerStats.create({
                            discordId,
                            username: player.username
                        });
                    }
    
                    // Update games played
                    await stats.increment('gamesPlayed');
                    
                    // Check if this player is in the winners Set
                    const isWinner = Array.from(winners).some(w => w.id === player.id);
                    if (isWinner) {
                        await stats.increment('gamesWon');
                    }
    
                    // Update role-specific count
                    const roleField = `times${player.role.charAt(0).toUpperCase() + player.role.slice(1)}`;
                    await stats.increment(roleField);
    
                    logger.info('Updated stats for player', { 
                        discordId,
                        username: player.username,
                        role: player.role,
                        won: isWinner
                    });
                } catch (error) {
                    logger.error('Error updating individual player stats', {
                        playerId,
                        error: error.message
                    });
                }
            }
        } catch (error) {
            logger.error('Error in updatePlayerStats', { 
                error: error.message,
                stack: error.stack 
            });
        }
    }
    // Add to the class

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

    /**
     * Serializes the complete game state for database storage
     */
    async serializeGame() {
        try {
            // First log the current state before serialization
            logger.info('Serializing game state', {
                phase: this.phase,
                round: this.round,
                playerCount: this.players.size
            });

            // Serialize all players
            const serializedPlayers = {};
            for (const [playerId, player] of this.players) {
                serializedPlayers[playerId] = player.toJSON();
            }

            // Serialize active message IDs
            const activeMessageIds = {
                dayPhaseMessage: this.currentDayPhaseMessageId,
                votingMessage: this.currentVotingMessageId,
                lastAnnouncement: this.lastAnnouncementId,
                activePrompts: Object.fromEntries(this.activePrompts || new Map())
            };

            // Serialize voting state
            const votingState = {
                nominatedPlayer: this.nominatedPlayer,
                nominator: this.nominator,
                seconder: this.seconder,
                votingOpen: this.votingOpen,
                votes: Object.fromEntries(this.votes),
                nominationStartTime: this.nominationStartTime,
                votingMessageId: this.currentVotingMessageId
            };

            // Serialize night state
            const nightState = {
                expectedActions: Array.from(this.expectedNightActions),
                completedActions: Array.from(this.completedNightActions),
                pendingActions: this.nightActions,
                lastProtectedPlayer: this.lastProtectedPlayer
            };

            // Serialize special role relationships
            const specialRoles = {
                lovers: Object.fromEntries(this.lovers),
                pendingHunterRevenge: this.pendingHunterRevenge,
                selectedRoles: Object.fromEntries(this.selectedRoles)
            };

            // Create the complete game state
            const gameState = {
                guildId: this.guildId,
                channelId: this.gameChannelId,
                werewolfChannelId: this.werewolfChannel?.id,
                deadChannelId: this.deadChannel?.id,
                categoryId: process.env.WEREWOLF_CATEGORY_ID,
                creatorId: this.gameCreatorId,
                phase: this.phase,
                round: this.round,
                activeMessageIds,
                players: serializedPlayers,
                votingState,
                nightState,
                specialRoles,
                gameStartTime: this.gameStartTime,
                lastUpdated: new Date()
            };

            // Validate the serialized state
            if (!gameState.phase || !PHASES[gameState.phase]) {
                throw new Error(`Invalid phase in game state: ${gameState.phase}`);
            }

            // Save to database
            await Game.upsert(gameState);

            logger.info('Game state serialized and saved successfully', {
                guildId: this.guildId,
                phase: this.phase,
                playerCount: Object.keys(serializedPlayers).length
            });

            return gameState;
        } catch (error) {
            logger.error('Error serializing game state', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Saves the current game state to the database
     */
    async saveGameState() {
        try {
            await GameStateManager.saveGameState(this);
            logger.info('Game state saved via manager', { 
                guildId: this.guildId,
                phase: this.phase
            });
        } catch (error) {
            logger.error('Error saving game state', { error });
            throw error;
        }
    }

    /**
     * Restores a game from saved state
     */
    static async restoreGame(client, guildId) {
        try {
            return await GameStateManager.restoreGameState(client, guildId);
        } catch (error) {
            logger.error('Error restoring game', { error });
            throw error;
        }
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
            await game.saveGameState();

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
     * Processes a night action by delegating to NightActionProcessor.
     * @param {string} playerId - The ID of the player performing the action.
     * @param {string} action - The action being performed.
     * @param {string} targetId - The ID of the target player.
     */
    async processNightAction(playerId, action, targetId) {
        return await this.nightActionProcessor.processNightAction(playerId, action, targetId);
    }

    /**
     * Processes all night actions and transitions to Day phase.
     */
    async processNightActions() {
        try {
             // Process  night actions
            await this.nightActionProcessor.processBodyguardProtection();
            await this.nightActionProcessor.processWerewolfAttacks();

            // Clean up night state
            this.nightActions = {};
            this.completedNightActions.clear();
            this.expectedNightActions.clear();

            // Check win conditions and advance phase
            const gameOver = await this.checkWinConditions();
            if (!gameOver) {
                await this.completePhase();
            }
        } catch (error) {
            logger.error('Error processing night actions', { error });
            // Even if there's an error, try to advance the phase
            if (!this.checkWinConditions()) {
                await this.advanceToDay();
            }
        }
    }

    /**
     * Checks win conditions to determine if the game should end.
     * @returns {boolean} - True if the game is over, else False.
     */
    async checkWinConditions() {
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
        
        // Count living werewolves
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        
        // Count living villager team (everyone who's not a werewolf)
        const livingVillagerTeam = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF).length;
    
        let winners = new Set();
        let gameOver = false;
    
        // Calculate game stats
        const gameStats = {
            rounds: this.round,
            totalPlayers: this.players.size,
            eliminations: this.players.size - alivePlayers.length,
            duration: this.getGameDuration(),
            players: Array.from(this.players.values())
        };
    
        // If all werewolves are dead, villagers win
        if (livingWerewolves === 0) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all non-werewolf players to winners
            this.players.forEach(player => {
                if (player.role !== ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
        }
    
        // If werewolves reach parity with or outnumber villager team, werewolves win
        if (livingWerewolves >= livingVillagerTeam) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all werewolf players to winners
            this.players.forEach(player => {
                if (player.role === ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
        }
    
        if (gameOver) {
            try {
                // Try to find and disable any active voting messages
                const channel = await this.client.channels.fetch(this.gameChannelId);
                const messages = await channel.messages.fetch({ limit: 10 });
                for (const message of messages.values()) {
                    if (message.components?.length > 0) {
                        await message.edit({ components: [] });
                    }
                }
            } catch (error) {
                logger.warn('Could not disable voting buttons', { error });
            }

            // Send game end message
            await this.broadcastMessage({
                embeds: [createGameEndEmbed(Array.from(winners), gameStats)]
            });
    
            // Update player stats
            await this.updatePlayerStats(winners);
    
            // Automatically clean up the game
            await this.shutdownGame();
            
            // Remove from client's games collection
            this.client.games.delete(this.guildId);
            
            // Clean up from database
            const Game = require('../models/Game');
            await Game.destroy({ where: { guildId: this.guildId } });
        }
    
        return gameOver;
    }
};

module.exports = WerewolfGame;

