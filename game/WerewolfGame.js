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
    }

    /**
     * Adds a player to the game.
     * @param {User} user - Discord user object.
     * @returns {Player} - The added player.
     */
    addPlayer(user) {
        logger.info('Adding player', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY 
        });
        
        if (this.phase !== PHASES.LOBBY) {
            throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
        }

        try {
            // Add debug logging
            logger.info('Attempting to add player', { 
                userId: user.id, 
                currentPhase: this.phase,
                isLobby: this.phase === PHASES.LOBBY 
            });

            // Check phase first
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
            }

            // Then check for duplicate players
            if (this.players.has(user.id)) {
                throw new GameError('Player already in game', 'You are already in the game.');
            }

            const player = new Player(user.id, user.username, this.client);
            this.players.set(user.id, player);
            // Save game state after adding player
            this.saveGameState().catch(error => {
                logger.error('Error saving game state after adding player', { error });
            });
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

            // Automatically add basic roles (no need for manual configuration)
            const playerCount = this.players.size;
            const werewolfCount = Math.max(1, Math.floor(playerCount / 4));
            
            // Always include 1 Seer and calculated number of Werewolves
            this.selectedRoles.set(ROLES.WEREWOLF, werewolfCount);
            this.selectedRoles.set(ROLES.SEER, 1);

            // Set phase before other operations
            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;

            await this.assignRoles();
            await this.createPrivateChannels();
            await this.broadcastMessage({
                embeds: [{
                    color: 0x800000,
                    title: '🌕 Night Falls on the Village 🐺',
                    description: 
                        '*As darkness descends, fear grips the hearts of the villagers...*\n\n' +
                        '**All players:** Please turn off your cameras and microphones now.\n' +
                        'The first night begins, and with it, ancient powers awaken...',
                    footer: { text: 'Stay silent until dawn breaks...' }
                }]
            });
            
            // Initialize night zero
            await this.nightZero();
            
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

            // If no Cupid, advance to Day phase immediately
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (!cupid || !cupid.isAlive) {
                // Set a short timeout to ensure all messages are sent before advancing
                setTimeout(async () => {
                    try {
                        logger.info('Advancing to Day phase after Night Zero (no Cupid)');
                        this.phase = PHASES.DAY;
                        this.round = 1; // Start first day
                        const channel = await this.client.channels.fetch(this.gameChannelId);
                        await dayPhaseHandler.createDayPhaseUI(channel, this.players);
                        await this.broadcastMessage('The sun rises on the first day. Discuss and find the werewolves!');
                    } catch (error) {
                        logger.error('Error advancing to day after Night Zero', { error: error.stack });
                        throw error;
                    }
                }, 2000);
            } else {
                // Handle Cupid's action
                await cupid.sendDM('Use `/action choose_lovers` to select your lover. You have 10 minutes.');
                this.expectedNightActions.add(cupid.id);
                
                // Set timeout for Cupid's action
                this.nightActionTimeout = setTimeout(async () => {
                    try {
                        logger.info('Advancing to Day phase after Cupid timeout');
                        this.phase = PHASES.DAY;
                        this.round = 1;
                        const channel = await this.client.channels.fetch(this.gameChannelId);
                        await dayPhaseHandler.createDayPhaseUI(channel, this.players);
                        await this.broadcastMessage('The sun rises on the first day. Discuss and find the werewolves!');
                    } catch (error) {
                        logger.error('Error advancing after Cupid timeout', { error: error.stack });
                        throw error;
                    }
                }, 600000); // 10 minutes
            }

            logger.info('Night Zero started');
        } catch (error) {
            logger.error('Error during Night Zero', { error: error.stack });
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
    
            // Clear any existing nomination before advancing to night
            if (this.nominatedPlayer) {
                await this.voteProcessor.clearNomination('Day phase is ending.');
            }
    
            // Set phase AFTER clearing nominations
            this.phase = PHASES.NIGHT;
            this.round += 1;
            
            await this.broadcastMessage({
                embeds: [{
                    color: 0x2C3E50,
                    title: '🌙 Night Falls Once More',
                    description: 
                        '*As darkness envelops the village, danger lurks in the shadows...*\n\n' +
                        '**All players:** Please turn off your cameras and microphones now.\n' +
                        'The night phase begins, and with it, dark deeds will be done...',
                    footer: { text: 'Remain silent until morning comes...' }
                }]
            });
    
            // Reset night action tracking
            this.completedNightActions.clear();
            this.expectedNightActions.clear();
            this.nightActions = {};
    
            // Save state AFTER all changes
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
    
    async advanceToDay() {
        try {
            // Guard against multiple transitions
            if (this.phase === PHASES.DAY) {
                logger.warn('Already in Day phase, skipping transition');
                return;
            }
    
            // Set phase first
            this.phase = PHASES.DAY;
            
            // Clear any night state
            this.completedNightActions.clear();
            this.expectedNightActions.clear();
            this.nightActions = {};
            
            await this.broadcastMessage({
                embeds: [{
                    color: 0xFFA500,
                    title: '☀️ Dawn Breaks Over the Village',
                    description: 
                        '*The morning sun reveals the events of the night...*\n\n' +
                        '**All players:** Please turn your cameras and microphones ON.\n' +
                        'The time for discussion begins. Who among you seems suspicious?',
                    footer: { text: 'Debate wisely, for a wrong accusation could doom the village.' }
                }]
            });
    
            // Save state AFTER all changes
            await this.saveGameState();
    
            const channel = await this.client.channels.fetch(this.gameChannelId);
            await dayPhaseHandler.createDayPhaseUI(channel, this.players);
    
            logger.info(`Advanced to Day ${this.round}`, {
                phase: this.phase,
                round: this.round,
                stateAfterSave: await Game.findByPk(this.guildId) // Add this to verify state
            });
    
        } catch (error) {
            logger.error('Error advancing to Day phase', { error, stack: error.stack });
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
        if (this.nightActionTimeout) {
            clearTimeout(this.nightActionTimeout);
            this.nightActionTimeout = null;
        }
        // Add any other cleanup needed
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
            // Send game end message without buttons
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
                winnerCount: winners.size 
            });
    
            for (const [playerId, player] of this.players) {
                try {
                    // Convert ID to string to match database format
                    const discordId = playerId.toString();
                    
                    let stats = await PlayerStats.findByPk(discordId);
                    if (!stats) {
                        logger.info('Creating new player stats record', { 
                            discordId, 
                            username: player.username 
                        });
                        stats = await PlayerStats.create({
                            discordId,
                            username: player.username
                        });
                    }
    
                    // Update stats
                    await stats.increment('gamesPlayed');
                    if (winners.has(playerId)) {
                        await stats.increment('gamesWon');
                    }
    
                    // Update role-specific count
                    const roleField = `times${player.role.charAt(0).toUpperCase() + player.role.slice(1)}`;
                    await stats.increment(roleField);
    
                    logger.info('Updated stats for player', { 
                        discordId,
                        username: player.username,
                        role: player.role,
                        won: winners.has(playerId)
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
     * Serializes the game state for database storage
     */
    serializeGame() {
        try {
            // First log the current state before serialization
            logger.info('Current game state before serialization', {
                phase: this.phase,
                round: this.round,
                playerCount: this.players.size,
                playersWithRoles: Array.from(this.players.values()).filter(p => p.role).length
            });
    
            const serializedState = {
                players: Array.from(this.players.values()).map(player => ({
                    id: player.id,
                    username: player.username,
                    role: player.role || null,  // Explicitly handle null case
                    isAlive: Boolean(player.isAlive),
                    isProtected: Boolean(player.isProtected)
                })),
                phase: this.phase,
                round: Number(this.round),
                votes: Array.from(this.votes.entries()),
                nightActions: this.nightActions || {},
                lastProtectedPlayer: this.lastProtectedPlayer,
                lovers: Array.from(this.lovers.entries()),
                selectedRoles: Array.from(this.selectedRoles.entries()),
                pendingHunterRevenge: this.pendingHunterRevenge,
                nominatedPlayer: this.nominatedPlayer,
                nominator: this.nominator,
                seconder: this.seconder,
                votingOpen: Boolean(this.votingOpen),
                completedNightActions: Array.from(this.completedNightActions),
                expectedNightActions: Array.from(this.expectedNightActions)
            };
    
            // Validate the serialized state
            if (!serializedState.phase || !PHASES[serializedState.phase]) {
                throw new Error(`Invalid phase in game state: ${serializedState.phase}`);
            }
    
            return serializedState;
        } catch (error) {
            logger.error('Error in serializeGame', { 
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
            // First get the current state
            const currentState = this.serializeGame();
            
            // Log the state we're about to save
            logger.info('Saving game state', { 
                guildId: this.guildId,
                currentPhase: this.phase,
                statePhase: currentState.phase,
                round: this.round,
                playerCount: this.players.size
            });
    
            // Save to database with explicit phase from current game state
            await Game.upsert({
                guildId: this.guildId,
                channelId: this.gameChannelId,
                creatorId: this.gameCreatorId,
                phase: this.phase,  // Use the actual current phase
                round: this.round,
                gameState: currentState,
                lastUpdated: new Date()
            });
            
            // Verify the save was successful
            const savedGame = await Game.findByPk(this.guildId);
            if (savedGame.phase !== this.phase) {
                logger.error('Phase mismatch after save', {
                    expectedPhase: this.phase,
                    savedPhase: savedGame.phase
                });
                throw new Error('Game state save verification failed');
            }
    
            logger.info('Game state saved successfully', { 
                guildId: this.guildId,
                phase: savedGame.phase,
                round: savedGame.round
            });
        } catch (error) {
            logger.error('Failed to save game state', { 
                error,
                currentPhase: this.phase,
                guildId: this.guildId
            });
            throw error;
        }
    }

    /**
     * Restores a game from saved state
     */
    static async restoreGame(client, guildId) {
        try {
            const savedGame = await Game.findByPk(guildId);
            if (!savedGame) {
                logger.error('No saved game found during restoration', { guildId });
                return null;
            }
    
            // Create new game instance using static create method
            const game = await WerewolfGame.create(
                client,
                savedGame.guildId,
                savedGame.channelId,
                savedGame.creatorId
            );
    
            // Restore game state from saved data
            const state = savedGame.gameState;
            if (!state) {
                logger.error('No game state found in saved game', { guildId });
                return null;
            }
    
            try {
                // First restore basic game properties
                game.phase = savedGame.phase;
                game.round = savedGame.round;
    
                // Restore players with error handling
                if (state.players && Array.isArray(state.players)) {
                    game.players.clear(); // Clear any default players
                    for (const playerData of state.players) {
                        try {
                            const player = new Player(playerData.id, playerData.username, client);
                            player.role = playerData.role;
                            player.isAlive = playerData.isAlive;
                            player.isProtected = playerData.isProtected;
                            game.players.set(player.id, player);
                        } catch (error) {
                            logger.error('Error restoring player', { error, playerData });
                        }
                    }
                }
    
                // Restore other game state with type checking
                game.votes = new Map(Array.isArray(state.votes) ? state.votes : []);
                game.nightActions = state.nightActions || {};
                game.lastProtectedPlayer = state.lastProtectedPlayer;
                game.lovers = new Map(Array.isArray(state.lovers) ? state.lovers : []);
                game.selectedRoles = new Map(Array.isArray(state.selectedRoles) ? state.selectedRoles : []);
                game.pendingHunterRevenge = state.pendingHunterRevenge;
                game.nominatedPlayer = state.nominatedPlayer;
                game.nominator = state.nominator;
                game.seconder = state.seconder;
                game.votingOpen = Boolean(state.votingOpen);
                game.completedNightActions = new Set(Array.isArray(state.completedNightActions) ? state.completedNightActions : []);
                game.expectedNightActions = new Set(Array.isArray(state.expectedNightActions) ? state.expectedNightActions : []);
    
                // Add to client.games map
                client.games.set(guildId, game);
    
                // Send restoration confirmation
                await game.broadcastMessage({
                    embeds: [{
                        color: 0x0099ff,
                        title: '🔄 Game Restored',
                        description: 
                            'The game has been restored after a brief interruption.\n\n' +
                            `**Current Phase:** ${game.phase}\n` +
                            `**Round:** ${game.round}\n` +
                            `**Players Alive:** ${game.getAlivePlayers().length}/${game.players.size}\n\n` +
                            (game.phase === 'LOBBY' ? 'The game is in the lobby phase.' : 'Continue with the current phase.'),
                        footer: { text: 'Use /game-status for detailed game information' }
                    }]
                });
    
                logger.info('Game restored successfully', {
                    guildId,
                    phase: game.phase,
                    round: game.round,
                    alivePlayers: game.getAlivePlayers().length
                });
    
                return game;
            } catch (error) {
                logger.error('Error restoring game state', { error });
                throw error;
            }
        } catch (error) {
            logger.error('Error in game restoration', { 
                error: error.message,
                stack: error.stack,
                guildId 
            });
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
};

module.exports = WerewolfGame;

