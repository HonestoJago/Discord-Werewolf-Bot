const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { 
    createNightActionEmbed, 
    createSeerRevealEmbed, 
    createProtectionEmbed,
    createNightTransitionEmbed,
    createLoverDeathEmbed,
    createHunterRevengeEmbed,
    createHunterTensionEmbed,
    createMinionRevealEmbed,
    createSorcererRevealEmbed
} = require('../utils/embedCreator');

class NightActionProcessor {
    constructor(game) {
        this.game = game;
        this.protectionMessageSent = false;
    }

    /**
     * Creates a snapshot of the current night action state
     * @returns {Object} Snapshot of current state
     */
    createNightSnapshot() {
        return {
            phase: this.game.phase,
            round: this.game.round,
            nightActions: { ...this.game.nightActions },
            expectedActions: new Set(this.game.expectedNightActions),
            completedActions: new Set(this.game.completedNightActions),
            lastProtectedPlayer: this.game.lastProtectedPlayer,
            pendingHunterRevenge: this.game.pendingHunterRevenge,
            // Deep copy of player states
            playerStates: new Map(
                Array.from(this.game.players.entries()).map(([id, player]) => [
                    id,
                    {
                        isAlive: player.isAlive,
                        isProtected: player.isProtected,
                        role: player.role
                    }
                ])
            ),
            // Copy investigation history
            roleHistory: {
                seer: { investigations: [...(this.game.roleHistory.seer?.investigations || [])] },
                sorcerer: { investigations: [...(this.game.roleHistory.sorcerer?.investigations || [])] }
            }
        };
    }

    /**
     * Restores night action state from a snapshot
     * @param {Object} snapshot - State snapshot to restore
     */
    restoreFromSnapshot(snapshot) {
        this.game.phase = snapshot.phase;
        this.game.round = snapshot.round;
        this.game.nightActions = { ...snapshot.nightActions };
        this.game.expectedNightActions = new Set(snapshot.expectedActions);
        this.game.completedNightActions = new Set(snapshot.completedActions);
        this.game.lastProtectedPlayer = snapshot.lastProtectedPlayer;
        this.game.pendingHunterRevenge = snapshot.pendingHunterRevenge;

        // Restore player states
        for (const [playerId, state] of snapshot.playerStates) {
            const player = this.game.players.get(playerId);
            if (player) {
                player.isAlive = state.isAlive;
                player.isProtected = state.isProtected;
                player.role = state.role;
            }
        }

        // Restore investigation history
        this.game.roleHistory = {
            seer: { investigations: [...snapshot.roleHistory.seer.investigations] },
            sorcerer: { investigations: [...snapshot.roleHistory.sorcerer.investigations] }
        };
    }

    /**
     * Atomically processes a night action
     * @param {string} playerId - ID of the player performing the action
     * @param {string} action - Type of action being performed
     * @param {string} targetId - ID of the target player
     */
    async processNightAction(playerId, action, targetId) {
        const snapshot = this.createNightSnapshot();
        
        try {
            const player = this.game.players.get(playerId);
            if (!player) {
                throw new GameError('Invalid player', 'You are not authorized to perform this action.');
            }

            // Handle Hunter's revenge immediately if applicable
            if (action === 'hunter_revenge' && player.id === this.game.pendingHunterRevenge) {
                await this.processHunterRevenge(player, this.game.players.get(targetId));
                return;
            }

            // Validate night action
            if (!this.game.expectedNightActions.has(playerId)) {
                logger.warn('Unexpected night action', {
                    playerId,
                    action,
                    expectedActions: Array.from(this.game.expectedNightActions)
                });
                throw new GameError('Invalid Action', 'You are not expected to take an action at this time.');
            }

            if (!player.isAlive) {
                throw new GameError('Dead players cannot perform actions', 'Dead players cannot perform actions.');
            }

            if (this.game.phase !== PHASES.NIGHT && this.game.phase !== PHASES.NIGHT_ZERO) {
                throw new GameError('Wrong phase', 'Night actions can only be performed during night phases');
            }

            // Validate target exists and is alive
            const targetPlayer = this.game.players.get(targetId);
            if (!targetPlayer || !targetPlayer.isAlive) {
                throw new GameError('Invalid target', 'Target player not found or is dead');
            }

            // Update state atomically
            this.updateNightActionState(playerId, {
                action,
                target: targetId,
                completed: true
            });

            // Save state before any external operations
            await this.game.saveGameState();

            // Handle immediate investigations
            if (action === 'investigate' || action === 'dark_investigate') {
                await this.handleImmediateInvestigation(player, targetPlayer, action);
            }

            // Send confirmation
            await this.sendActionConfirmation(player, action);

            logger.info('Night action collected', { playerId, action, targetId });

            // Check if all actions are complete
            if (this.checkAllActionsComplete()) {
                await this.processNightActions();
            }

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error processing night action', { error });
            throw error;
        }
    }

    /**
     * Updates night action state atomically to maintain consistency
     * @param {string} playerId - The ID of the player performing the action
     * @param {Object} actionData - Data about the night action
     * @param {string} actionData.action - The type of action being performed
     * @param {string} actionData.target - The target of the action
     * @param {boolean} actionData.completed - Whether the action is completed
     */
    updateNightActionState(playerId, actionData) {
        // Create new night actions object with the update
        const newNightActions = {
            ...this.game.nightActions,
            [playerId]: { 
                action: actionData.action, 
                target: actionData.target 
            }
        };

        // Create new completed actions set if action is marked complete
        const newCompletedActions = new Set(this.game.completedNightActions);
        if (actionData.completed) {
            newCompletedActions.add(playerId);
        }

        // Update state atomically
        this.game.nightActions = Object.freeze(newNightActions);
        this.game.completedNightActions = newCompletedActions;
    }

    /**
     * Updates investigation history state atomically
     * @param {Object} investigationData - Data about the investigation
     */
    updateInvestigationHistory(investigationData) {
        const { type, ...data } = investigationData;
        const roleType = type === 'seer' ? 'seer' : 'sorcerer';

        // Create new history object with investigation result
        const newHistory = {
            ...this.game.roleHistory,
            [roleType]: {
                investigations: [
                    ...(this.game.roleHistory[roleType]?.investigations || []),
                    {
                        [`${roleType}Id`]: data.investigatorId,
                        targetId: data.targetId,
                        round: this.game.round,
                        result: data.result,
                        timestamp: Date.now()
                    }
                ]
            }
        };

        // Update history state atomically
        this.game.roleHistory = Object.freeze(newHistory);
    }

    /**
     * Updates lover relationships atomically
     * @param {string} cupidId - The ID of Cupid
     * @param {string} loverId - The ID of the chosen lover
     */
    updateLoverState(cupidId, loverId) {
        // Create new lovers map with bidirectional relationship
        const newLovers = new Map(this.game.lovers);
        newLovers.set(cupidId, loverId);
        newLovers.set(loverId, cupidId);

        // Update lovers state atomically
        this.game.lovers = newLovers;
    }

    async processNightActions() {
        try {
            // Process other night actions...
            await this.processBodyguardProtection();
            await this.processWerewolfAttacks();

            // Clean up night state
            this.game.nightActions = {};
            this.game.completedNightActions.clear();
            this.game.expectedNightActions.clear();

            // Add logging before phase transition
            logger.info('Night actions processed, attempting phase transition', {
                currentPhase: this.game.phase,
                round: this.game.round
            });

            // Check win conditions and advance phase
            if (!this.game.checkWinConditions()) {
                // Direct call to advance phase, exactly like advance.js does
                await this.game.advanceToDay();
                
                logger.info('Advanced to day after night actions', {
                    currentPhase: this.game.phase,
                    round: this.game.round
                });
            }
        } catch (error) {
            logger.error('Error processing night actions', { error });
            // Even if there's an error, try to advance the phase
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToDay();
            }
        }
    }

    async processBodyguardProtection() {
        const snapshot = this.createNightSnapshot();
        
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'protect') {
                    const target = this.game.players.get(action.target);
                    if (target) {
                        // Update protection state atomically
                        target.isProtected = true;
                        this.game.lastProtectedPlayer = target.id;
                        
                        // Save state before any external operations
                        await this.game.saveGameState();
                        
                        logger.info('Bodyguard protected player', { targetId: target.id });
                    }
                }
            }
        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error processing bodyguard protection', { error });
            throw error;
        }
    }

    async processHunterRevenge(hunter, target) {
        if (!target || !target.isAlive) {
            throw new GameError('Invalid target', 'Target player not found or is already dead');
        }

        // Mark target as dead
        target.isAlive = false;

        // Send message to the game channel
        await this.game.broadcastMessage({
            embeds: [createHunterRevengeEmbed(hunter.username, target.username)]
        });

        // Move target to dead channel
        await this.game.moveToDeadChannel(target);

        logger.info('Hunter took revenge', {
            hunterId: hunter.id,
            targetId: target.id
        });
    }

    async finishNightPhase() {
        // Process any pending Hunter revenge if they didn't act
        if (this.game.pendingHunterRevenge) {
            const hunter = this.game.players.get(this.game.pendingHunterRevenge);
            if (hunter) {
                hunter.isAlive = false;
                await this.game.moveToDeadChannel(hunter);
                await this.game.handleLoversDeath(hunter);
            }
            this.game.pendingHunterRevenge = null;
        }

        // Reset protections
        for (const player of this.game.players.values()) {
            player.isProtected = false;
        }

        // Track phase advance for timing test
        if (this.executionOrder) {
            this.executionOrder.push('phase_advance');
        }

        // Check win conditions before advancing
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToDay();
        }
    }

    validateNightAction(player, action, targetId) {
        // Special case for Hunter's revenge - skip other validations
        if ((action === 'choose_target' || action === 'hunter_revenge') && 
            player.id === this.game.pendingHunterRevenge) {
            return;
        }

        // Role-specific validations should come before checking expected actions
        switch(action) {
            case 'choose_lovers':
                if (player.role !== ROLES.CUPID) {
                    throw new GameError('Invalid role', 'Only Cupid can choose a lover.');
                }
                if (this.game.phase !== PHASES.NIGHT_ZERO) {
                    throw new GameError('Invalid phase', 'Cupid can only choose lovers during Night Zero.');
                }
                break;
            case 'protect':
                if (player.role !== ROLES.BODYGUARD) {
                    throw new GameError('Invalid role', 'Only the Bodyguard can protect players.');
                }
                break;
            case 'investigate':
                if (player.role !== ROLES.SEER) {
                    throw new GameError('Invalid role', 'Only the Seer can investigate players.');
                }
                break;
            case 'dark_investigate':
                if (player.role !== ROLES.SORCERER) {
                    throw new GameError('Invalid role', 'Only the Sorcerer can perform dark investigations.');
                }
                break;
            case 'attack':
                if (player.role !== ROLES.WEREWOLF) {
                    throw new GameError('Invalid role', 'Only Werewolves can attack players.');
                }
                break;
            case 'choose_target':
            case 'hunter_revenge':
                if (player.role !== ROLES.HUNTER || !this.game.pendingHunterRevenge) {
                    throw new GameError('Invalid action', 'Only the Hunter can choose a target after being eliminated.');
                }
                break;
            default:
                throw new GameError('Unknown action type', 'Unknown action type.');
        }

        // Check if player has already acted
        if (this.game.completedNightActions.has(player.id)) {
            throw new GameError(
                'Action already performed',
                'You have already performed your night action.'
            );
        }

        // Check if player is expected to act
        if (!this.game.expectedNightActions.has(player.id)) {
            throw new GameError(
                'Unexpected action',
                'You are not expected to perform any action at this time.'
            );
        }

        // Additional target validations
        if (action === 'protect') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot protect yourself.');
            }
            if (this.game.lastProtectedPlayer && targetId === this.game.lastProtectedPlayer) {
                throw new GameError('Invalid target', 'You cannot protect the same player two nights in a row.');
            }
        }

        if (action === 'investigate' || action === 'dark_investigate') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot investigate yourself.');
            }
        }

        if (action === 'attack') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot attack yourself.');
            }
        }

        if (action === 'choose_lovers') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot choose yourself as a lover.');
            }
        }
    }

    /**
     * Handles all night actions including Night Zero actions.
     */
    async handleNightActions() {
        try {
            logger.info('Handling night actions', { phase: this.game.phase });

            // Send night transition embed FIRST
            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            await channel.send({
                embeds: [createNightTransitionEmbed(this.game.players)]
            });

            // Identify all players with night actions
            const nightRoles = [ROLES.WEREWOLF, ROLES.SEER, ROLES.BODYGUARD, ROLES.SORCERER];
            const nightPlayers = Array.from(this.game.players.values()).filter(player => 
                nightRoles.includes(player.role) && player.isAlive
            );

            logger.info('Identified night action players', { players: nightPlayers.map(p => p.username) });

            // Add night players to expectedNightActions
            nightPlayers.forEach(player => {
                this.game.expectedNightActions.add(player.id);
            });

            // Send DM prompts with dropdown menus to night action players
            for (const player of nightPlayers) {
                const validTargets = this.getValidTargetsForRole(player);
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`night_action_${player.role.toLowerCase()}`)
                    .setPlaceholder('Select your target')
                    .addOptions(
                        validTargets.map(target => ({
                            label: target.username,
                            value: target.id,
                            description: `Target ${target.username}`
                        }))
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);
                const embed = createNightActionEmbed(player.role);

                await player.sendDM({ 
                    embeds: [embed], 
                    components: [row] 
                });

                logger.info(`Sent ${player.role} action prompt`, { 
                    username: player.username 
                });
            }

            logger.info('Night action prompts sent, waiting for actions', {
                expectedActions: Array.from(this.game.expectedNightActions)
            });

        } catch (error) {
            logger.error('Error handling night actions', { error });
            throw error;
        }
    }

    getValidTargetsForRole(player) {
        const allPlayers = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== player.id);

        switch(player.role) {
            case ROLES.WEREWOLF:
                return allPlayers.filter(p => p.role !== ROLES.WEREWOLF);
            case ROLES.BODYGUARD:
                return allPlayers.filter(p => 
                    p.id !== this.game.lastProtectedPlayer
                );
            case ROLES.SEER:
                return allPlayers;
            case ROLES.SORCERER:
                return allPlayers;
            default:
                return [];
        }
    }

    /**
     * Waits for Cupid to complete their action during Night Zero.
     */
    async waitForCupidAction() {
        return new Promise((resolve, reject) => {
            // Listen for Cupid's action completion
            const interval = setInterval(() => {
                if (!this.game.expectedNightActions.has(this.game.cupidId)) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000);

            // Set a maximum wait time to prevent indefinite waiting
            setTimeout(() => {
                clearInterval(interval);
                logger.warn('Cupid did not complete their action in time.');
                resolve(); // Proceed to Day phase regardless
            }, 60000); // 1 minute
        });
    }

    /**
     * Collects Werewolf attack target.
     * @param {Player[]} werewolves - Array of werewolf players.
     */
    async collectWerewolfAttack(werewolves) {
        try {
            const attackTargets = werewolves.map(wolf => 
                wolf.promptDM('Choose a player to attack by typing their username:')
            );

            const responses = await Promise.all(attackTargets);
            const validResponses = responses.filter(response => response !== null);

            if (validResponses.length === 0) {
                logger.warn('No valid attack targets provided by werewolves');
                return;
            }

            // Use the local getMostFrequent method instead of game's
            const target = this.getMostFrequent(validResponses);
            const victim = this.game.getPlayerByUsername(target);

            if (!victim || victim.role === ROLES.WEREWOLF || !victim.isAlive) {
                logger.warn('Invalid attack target chosen by werewolves', { target });
                return;
            }

            this.game.nightActions.werewolfVictim = victim.id;
            logger.info('Werewolf attack recorded', { 
                attackerIds: werewolves.map(w => w.id), 
                targetId: victim.id 
            });
        } catch (error) {
            logger.error('Error collecting Werewolf attack', { error });
            throw error;
        }
    }

    /**
     * Collects Seer investigation target.
     * @param {Player} seer - The Seer player.
     */
    async collectSeerInvestigation(seer) {
        try {
            const investigationTarget = await seer.promptDM('Choose a player to investigate by typing their username:');
            if (!investigationTarget) {
                logger.warn('Seer failed to provide an investigation target', { seerId: seer.id });
                return;
            }

            const target = this.game.getPlayerByUsername(investigationTarget);
            if (!target || !target.isAlive) {
                await seer.sendDM('Invalid target. Your investigation has failed.');
                logger.warn('Invalid Seer investigation target', { seerId: seer.id, targetUsername: investigationTarget });
                return;
            }

            this.game.nightActions.seerTarget = target.id;
            logger.info('Seer investigation recorded', { seerId: seer.id, targetId: target.id });
        } catch (error) {
            logger.error('Error collecting Seer investigation', { error });
            throw error;
        }
    }

    /**
     * Collects Cupid's lover selection.
     * @param {Player} cupid - The Cupid player.
     */
    async collectCupidLover(cupid) {
        try {
            const chooseLoverMessage = 'Choose a player to be your lover by typing their username. Choose wisely - if either of you dies, the other will die of heartbreak.';
            const loverResponse = await cupid.promptDM(chooseLoverMessage);
            
            if (!loverResponse) {
                logger.warn('Cupid failed to choose a lover', { cupidId: cupid.id });
                return;
            }

            const lover = this.game.getPlayerByUsername(loverResponse);
            if (!lover || !lover.isAlive || lover.id === cupid.id) {
                await cupid.sendDM('Invalid lover selection.');
                logger.warn('Invalid lover selection by Cupid', { 
                    cupidId: cupid.id, 
                    targetUsername: loverResponse 
                });
                return;
            }

            this.game.nightActions[cupid.id] = {
                action: 'choose_lovers',
                target: lover.id
            };

            logger.info('Cupid chose lover', { 
                cupidId: cupid.id, 
                loverId: lover.id 
            });
        } catch (error) {
            logger.error('Error collecting Cupid lover selection', { error });
            throw error;
        }
    }

    /**
     * Processes Cupid's action during Night Zero.
     */
    async processCupidAction() {
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'choose_lovers') {
                    const cupid = this.game.players.get(playerId);
                    const lover = this.game.players.get(action.target);
                    
                    if (!cupid || !lover) {
                        logger.error('Invalid Cupid or lover selection', { 
                            cupidId: playerId, 
                            loverId: action.target 
                        });
                        continue;
                    }

                    if (!lover.isAlive) {
                        logger.error('Cannot select dead player as lover', { 
                            loverId: action.target 
                        });
                        continue;
                    }

                    if (cupid.id === lover.id) {
                        logger.error('Cupid cannot select self as lover', { 
                            cupidId: cupid.id 
                        });
                        continue;
                    }

                    // Set up bidirectional lover relationship
                    this.game.lovers.set(cupid.id, lover.id);
                    this.game.lovers.set(lover.id, cupid.id);
                    
                    // Notify both players
                    await lover.sendDM({
                        embeds: [{
                            color: 0xff69b4,
                            title: '💘 You Have Been Chosen!',
                            description: `**${cupid.username}** has chosen you as their lover. If either of you dies, the other will die of heartbreak.`
                        }]
                    });
                    
                    await cupid.sendDM({
                        embeds: [{
                            color: 0xff69b4,
                            title: '💘 Love Blossoms',
                            description: `You have chosen **${lover.username}** as your lover. If either of you dies, the other will die of heartbreak.`
                        }]
                    });

                    logger.info('Lovers set', {
                        cupidId: cupid.id,
                        cupidName: cupid.username,
                        loverId: lover.id,
                        loverName: lover.username,
                        loversMap: Array.from(this.game.lovers.entries())
                    });

                    // After processing Cupid's action, finish Night Zero
                    await this.game.finishNightZero();
                }
            }
        } catch (error) {
            logger.error('Error processing Cupid action', { error });
            // Even if there's an error, try to advance the phase
            await this.game.finishNightZero();
        }
    }

    getMostFrequent(arr) {
        const counts = {};
        let maxCount = 0;
        let maxValue;

        for (const value of arr) {
            counts[value] = (counts[value] || 0) + 1;
            if (counts[value] > maxCount) {
                maxCount = counts[value];
                maxValue = value;
            }
        }

        return maxValue;
    }

    /**
     * Atomically processes werewolf attacks
     */
    async processWerewolfAttacks() {
        const snapshot = this.createNightSnapshot();
        
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'attack') {
                    const target = this.game.players.get(action.target);
                    
                    logger.info('Processing werewolf attack', {
                        targetId: action.target,
                        targetRole: target?.role,
                        targetIsAlive: target?.isAlive,
                        targetIsProtected: target?.isProtected,
                        hasLovers: !!this.game.lovers.get(action.target)
                    });

                    if (!target?.isAlive) {
                        continue;
                    }

                    if (target.isProtected) {
                        if (!this.protectionMessageSent) {
                            await this.game.broadcastMessage({
                                embeds: [createProtectionEmbed(true)]
                            });
                            this.protectionMessageSent = true;
                        }
                        continue;
                    }

                    // Handle Hunter case atomically
                    if (target.role === ROLES.HUNTER) {
                        await this.handleHunterNightDeath(target);
                        return;
                    }

                    // Mark target as dead and update state
                    target.isAlive = false;
                    await this.game.saveGameState();

                    // Handle external operations
                    await this.game.broadcastMessage({
                        embeds: [{
                            color: 0x800000,
                            title: '🐺 A Grim Discovery',
                            description: 
                                `*As dawn breaks, the village finds **${target.username}** dead, their body savagely mauled...*\n\n` +
                                `The werewolves have claimed another victim.`,
                            footer: { text: 'The hunt continues...' }
                        }]
                    });
                    
                    await this.game.moveToDeadChannel(target);
                    await this.handleLoversDeath(target);
                }
            }

            // Check win conditions and advance phase
            const gameOver = await this.game.checkWinConditions();
            if (!gameOver) {
                await this.game.advanceToDay();
            }

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error processing werewolf attacks', { 
                error: error.message,
                stack: error.stack 
            });
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToDay();
            }
        } finally {
            this.protectionMessageSent = false;
        }
    }

    /**
     * Atomically handles Hunter's death during night phase
     * @param {Player} hunter - The Hunter player
     */
    async handleHunterNightDeath(hunter) {
        const snapshot = this.createNightSnapshot();
        
        try {
            this.game.pendingHunterRevenge = hunter.id;
            
            // Create dropdown for Hunter's revenge
            const validTargets = Array.from(this.game.players.values())
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

            // Save state before external operations
            await this.game.saveGameState();

            // Send DM to Hunter with dropdown
            await hunter.sendDM({
                embeds: [createHunterRevengeEmbed()],
                components: [row]
            });

            // Send mysterious message to village
            await this.game.broadcastMessage({
                embeds: [createHunterTensionEmbed(false)]
            });

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error handling Hunter night death', { error });
            throw error;
        }
    }

    /**
     * Atomically handles immediate investigation results
     * @param {Player} investigator - The investigating player
     * @param {Player} target - The target player
     * @param {string} action - The type of investigation
     */
    async handleImmediateInvestigation(investigator, target, action) {
        const snapshot = this.createNightSnapshot();
        
        try {
            if (!target) {
                throw new GameError('Invalid target', 'Target player not found.');
            }

            let result, embed;
            if (action === 'investigate') {
                const isWerewolf = target.role === ROLES.WEREWOLF;
                embed = createSeerRevealEmbed(target, isWerewolf);
                result = isWerewolf;

                // Update investigation history
                this.updateInvestigationHistory({
                    investigatorId: investigator.id,
                    targetId: target.id,
                    result: isWerewolf,
                    type: 'seer'
                });

                logger.info('Seer investigation completed', {
                    seerId: investigator.id,
                    targetId: target.id,
                    targetAlive: target.isAlive,
                    result: isWerewolf ? 'werewolf' : 'not werewolf'
                });
            } else if (action === 'dark_investigate') {
                const isSeer = target.role === ROLES.SEER;
                embed = createSorcererRevealEmbed(target, isSeer);
                result = isSeer;

                // Update investigation history
                this.updateInvestigationHistory({
                    investigatorId: investigator.id,
                    targetId: target.id,
                    result: isSeer,
                    type: 'sorcerer'
                });

                logger.info('Sorcerer investigation completed', {
                    sorcererId: investigator.id,
                    targetId: target.id,
                    targetAlive: target.isAlive,
                    result: isSeer ? 'seer' : 'not seer'
                });
            }

            // Save state before sending DM
            await this.game.saveGameState();

            // Send result to investigator
            await investigator.sendDM({ embeds: [embed] });

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error handling investigation', { error });
            throw error;
        }
    }

    /**
     * Atomically handles Night Zero setup and initial role reveals
     */
    async handleNightZero() {
        const snapshot = this.createNightSnapshot();
        
        try {
            logger.info('Starting Night Zero phase');

            // Prepare all initial state changes
            const stateChanges = {
                phase: PHASES.NIGHT_ZERO,
                round: 0,
                initialVisions: new Map(),
                roleReveals: new Map()
            };

            // Get werewolves and prepare their team info
            const werewolves = this.game.getPlayersByRole(ROLES.WEREWOLF);
            const werewolfNames = werewolves.map(w => w.username).join(', ');
            
            // Prepare Seer's initial vision
            const seer = this.game.getPlayerByRole(ROLES.SEER);
            if (seer?.isAlive) {
                const validTargets = Array.from(this.game.players.values()).filter(
                    p => p.id !== seer.id && p.isAlive && p.role !== ROLES.WEREWOLF
                );
                
                if (validTargets.length > 0) {
                    const randomTarget = validTargets[Math.floor(Math.random() * validTargets.length)];
                    const isWerewolf = randomTarget.role === ROLES.WEREWOLF;
                    
                    stateChanges.initialVisions.set(seer.id, {
                        targetId: randomTarget.id,
                        isWerewolf: isWerewolf
                    });
                }
            }

            // Apply state changes atomically
            this.game.phase = stateChanges.phase;
            this.game.round = stateChanges.round;

            // Save state before external operations
            await this.game.saveGameState();

            // Now handle external operations (DMs and reveals)
            // Send werewolf team info
            for (const werewolf of werewolves) {
                await werewolf.sendDM({
                    embeds: [{
                        color: 0x800000,
                        title: '🐺 Your Pack',
                        description: werewolves.length > 1 ?
                            `*Your fellow werewolves are: **${werewolfNames}***` :
                            '*You are the lone werewolf. Hunt carefully...*',
                        footer: { text: 'Coordinate with your pack during the night phase...' }
                    }]
                });
            }

            // Handle Minion's werewolf reveal
            const minion = this.game.getPlayerByRole(ROLES.MINION);
            if (minion?.isAlive) {
                await minion.sendDM({
                    embeds: [createMinionRevealEmbed(werewolves)]
                });
                
                logger.info('Sent werewolf information to Minion', {
                    minionId: minion.id,
                    minionName: minion.username,
                    werewolfCount: werewolves.length
                });
            }

            // Handle Seer's initial vision
            if (seer?.isAlive) {
                const vision = stateChanges.initialVisions.get(seer.id);
                if (vision) {
                    const target = this.game.players.get(vision.targetId);
                    
                    // Update investigation history atomically
                    this.updateInvestigationHistory({
                        investigatorId: seer.id,
                        targetId: vision.targetId,
                        result: vision.isWerewolf,
                        type: 'seer',
                        isInitialVision: true
                    });
                    
                    await seer.sendDM({
                        embeds: [createSeerRevealEmbed(target, vision.isWerewolf)]
                    });
                    
                    logger.info('Seer received initial vision', {
                        seerId: seer.id,
                        targetId: target.id,
                        isWerewolf: vision.isWerewolf,
                        targetRole: target.role
                    });
                }
            }

            // Handle Cupid if present
            const cupid = this.game.getPlayerByRole(ROLES.CUPID);
            if (cupid?.isAlive) {
                // Add Cupid to expected actions
                this.game.expectedNightActions.add(cupid.id);
                await this.setupCupidAction(cupid);
            } else {
                // If no Cupid, proceed to Day phase
                await this.game.advanceToDay();
            }

            logger.info('Night Zero setup completed successfully');

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error during Night Zero', { error });
            // Even if there's an error, try to advance to Day phase
            await this.game.advanceToDay();
        }
    }

    areAllNightActionsComplete() {
        return Array.from(this.game.expectedNightActions).every(
            playerId => this.game.completedNightActions.has(playerId)
        );
    }

    async handleLoversDeath(deadPlayer) {
        const loverId = this.game.lovers.get(deadPlayer.id);
        if (!loverId) {
            logger.info('No lover found for dead player', {
                playerId: deadPlayer.id,
                playerName: deadPlayer.username
            });
            return; // Silently return if no lover found
        }

        try {
            logger.info('Handling lover death', {
                deadPlayerId: deadPlayer.id,
                deadPlayerName: deadPlayer.username,
                loversMap: Array.from(this.game.lovers.entries())
            });

            const lover = this.game.players.get(loverId);
            if (!lover || !lover.isAlive) {
                return;
            }

            // Mark lover as dead
            lover.isAlive = false;

            // Send heartbreak message
            await this.game.broadcastMessage({
                embeds: [createLoverDeathEmbed(lover.username)]
            });

            // Move lover to dead channel
            await this.game.moveToDeadChannel(lover);

            logger.info('Lover died of heartbreak', {
                originalDeadPlayer: deadPlayer.username,
                loverName: lover.username
            });

        } catch (error) {
            logger.error('Error handling lover death', { 
                error: error.message,
                stack: error.stack,
                deadPlayerId: deadPlayer.id
            });
        }
    }

    async processNightZeroAction(playerId, targetId) {
        try {
            // Validate the action
            if (!this.game.expectedNightActions.has(playerId)) {
                throw new GameError('Invalid Action', 'You are not expected to take an action at this time.');
            }

            const cupid = this.game.players.get(playerId);
            const lover = this.game.players.get(targetId);

            if (!cupid || !lover) {
                throw new GameError('Invalid players', 'Could not find one or both players.');
            }

            if (!lover.isAlive) {
                throw new GameError('Invalid target', 'Cannot select a dead player as lover.');
            }

            if (cupid.id === lover.id) {
                throw new GameError('Invalid target', 'You cannot choose yourself as a lover.');
            }

            // Use new state management method for lovers
            this.updateLoverState(cupid.id, lover.id);
            
            // Create new completed actions set
            const newCompletedActions = new Set(this.game.completedNightActions);
            newCompletedActions.add(playerId);
            this.game.completedNightActions = newCompletedActions;

            // Notify both players
            await lover.sendDM({
                embeds: [{
                    color: 0xff69b4,
                    title: '💘 You Have Been Chosen!',
                    description: `**${cupid.username}** has chosen you as their lover. If either of you dies, the other will die of heartbreak.`
                }]
            });
            
            await cupid.sendDM({
                embeds: [{
                    color: 0xff69b4,
                    title: '💘 Love Blossoms',
                    description: `You have chosen **${lover.username}** as your lover. If either of you dies, the other will die of heartbreak.`
                }]
            });

            logger.info('Lovers set', {
                cupidId: cupid.id,
                cupidName: cupid.username,
                loverId: lover.id,
                loverName: lover.username,
                loversMap: Array.from(this.game.lovers.entries())
            });

            // Since this is the only Night Zero action, advance to Day
            await this.game.advanceToDay();

        } catch (error) {
            logger.error('Error processing Night Zero action', { error });
            throw error;
        }
    }

    /**
     * Checks if all expected night actions have been completed
     * @returns {boolean} True if all actions are complete
     */
    checkAllActionsComplete() {
        const allComplete = Array.from(this.game.expectedNightActions).every(
            id => this.game.completedNightActions.has(id)
        );

        if (allComplete) {
            logger.info('All night actions received, processing night phase', {
                expectedActions: Array.from(this.game.expectedNightActions),
                completedActions: Array.from(this.game.completedNightActions)
            });
        }

        return allComplete;
    }

    /**
     * Sends appropriate notification to player about their action
     * @param {Player} player - The player who performed the action
     * @param {string} action - The type of action performed
     */
    async sendActionConfirmation(player, action) {
        if (action !== 'investigate' && action !== 'dark_investigate') {
            await player.sendDM('Your action has been recorded. Wait for the night phase to end to see the results.');
        }
    }

    /**
     * Sets up Cupid's action during Night Zero
     * @param {Player} cupid - The Cupid player
     */
    async setupCupidAction(cupid) {
        const snapshot = this.createNightSnapshot();
        
        try {
            // Create dropdown for Cupid's lover selection
            const validTargets = Array.from(this.game.players.values())
                .filter(p => p.isAlive && p.id !== cupid.id)
                .map(p => ({
                    label: p.username,
                    value: p.id,
                    description: `Choose ${p.username} as your lover`
                }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('night_action_cupid')
                .setPlaceholder('Select your lover')
                .addOptions(validTargets);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const embed = createNightActionEmbed(ROLES.CUPID);

            // Save state before external operations
            await this.game.saveGameState();

            // Send DM to Cupid with dropdown
            await cupid.sendDM({ 
                embeds: [embed], 
                components: [row] 
            });

            logger.info('Sent Cupid action prompt', { 
                cupidId: cupid.id,
                cupidName: cupid.username,
                validTargetCount: validTargets.length
            });

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error setting up Cupid action', { error });
            throw error;
        }
    }
}

module.exports = NightActionProcessor; 