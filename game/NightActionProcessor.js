const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createSeerRevealEmbed } = require('../utils/embedCreator');

class NightActionProcessor {
    constructor(game) {
        this.game = game;
        this.investigationProcessed = false;
    }

    async processNightAction(playerId, action, targetId) {
        try {
            // Add validation for required night actions
            if (!this.game.expectedNightActions.has(playerId)) {
                logger.warn('Unexpected night action', {
                    playerId,
                    action,
                    expectedActions: Array.from(this.game.expectedNightActions)
                });
                throw new GameError('Invalid Action', 'You are not expected to take an action at this time.');
            }

            const player = this.game.players.get(playerId);
            if (!player) {
                throw new GameError(
                    'You are not authorized to perform this action', 
                    'You are not authorized to perform this action.'
                );
            }

            // Handle Hunter's revenge
            if (action === 'choose_target' || action === 'hunter_revenge') {
                if (!this.game.pendingHunterRevenge || player.id !== this.game.pendingHunterRevenge) {
                    throw new GameError('Invalid action', 'You can only use this action when prompted after being eliminated as the Hunter.');
                }
                return await this.processHunterRevenge(player, targetId);
            }

            // Regular night action validation
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

            // Validate action based on phase and role
            this.validateNightAction(player, action, targetId);

            // Check if action was already submitted
            if (this.game.completedNightActions.has(playerId)) {
                throw new GameError('Action already submitted', 'You have already submitted your action for this night.');
            }

            // Handle Seer investigation immediately
            if (action === 'investigate') {
                const seer = this.game.players.get(playerId);
                const target = this.game.players.get(targetId);

                if (!target) {
                    throw new GameError('Invalid target', 'Target player not found.');
                }

                const isWerewolf = target.role === ROLES.WEREWOLF;
                const aliveStatus = target.isAlive ? '' : ' (deceased)';
                
                // Send the result immediately
                await seer.sendDM({
                    embeds: [{
                        color: 0x4B0082,
                        title: '🔮 Vision Revealed',
                        description: 
                            `*Your mystical powers reveal the truth about **${target.username}**${aliveStatus}...*\n\n` +
                            `Your vision shows that they are **${isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}**`,
                        footer: { text: 'Use this knowledge wisely...' }
                    }]
                });

                logger.info('Seer investigation completed', {
                    seerId: seer.id,
                    targetId: target.id,
                    targetAlive: target.isAlive,
                    result: isWerewolf ? 'werewolf' : 'not werewolf'
                });
            }

            // Store the action for other roles
            this.game.nightActions[playerId] = { action, target: targetId };
            this.game.completedNightActions.add(playerId);

            // Only send generic confirmation for non-Seer actions
            if (action !== 'investigate') {
                await player.sendDM('Your action has been recorded. Wait for the night phase to end to see the results.');
            }

            logger.info('Night action collected', { playerId, action, targetId });

            // Check if all actions are complete and process if they are
            if (this.areAllNightActionsComplete()) {
                await this.processNightActions();
            }

        } catch (error) {
            logger.error('Error processing night action', { error });
            throw error;
        }
    }

    async processNightActions() {
        try {
            // Process protection
            await this.processBodyguardProtection();

            // Then process attacks and deaths
            await this.processWerewolfAttacks();

            // Clean up night state
            this.game.nightActions = {};
            this.game.completedNightActions.clear();
            this.game.expectedNightActions.clear();

            // Check win conditions after all deaths
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToDay();
            }
        } catch (error) {
            logger.error('Error processing night actions', { error });
        }
    }

    async processBodyguardProtection() {
        for (const [playerId, action] of Object.entries(this.game.nightActions)) {
            if (action.action === 'protect') {
                const target = this.game.players.get(action.target);
                if (target) {
                    target.isProtected = true;
                    this.game.lastProtectedPlayer = target.id;
                    logger.info('Bodyguard protected player', { targetId: target.id });
                }
            }
        }
    }

    async processHunterRevenge(player, target) {
        if (player.id !== this.game.pendingHunterRevenge) {
            throw new GameError('Invalid action', 'You can only use this action when eliminated as the Hunter.');
        }
        
        const targetPlayer = this.game.players.get(target);
        if (!targetPlayer?.isAlive) {
            throw new GameError('Invalid target', 'You must choose a living player.');
        }

        // Mark both players as dead
        player.isAlive = false;
        targetPlayer.isAlive = false;

        // Broadcast the revenge
        await this.game.broadcastMessage(`**${player.username}** uses their dying action to take **${targetPlayer.username}** with them!`);
        
        // Move both to dead channel
        await this.game.moveToDeadChannel(player);
        await this.game.moveToDeadChannel(targetPlayer);
        
        // Handle any lover deaths
        await this.game.handleLoversDeath(targetPlayer);
        
        // Clear the pending state
        this.game.pendingHunterRevenge = null;
        this.game.expectedNightActions.delete(player.id);
        
        // Finish the night phase
        await this.finishNightPhase();
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

    validateNightAction(player, action, target) {
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
                throw new GameError('Invalid action', 'Unknown action type.');
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
            if (target === player.id) {
                throw new GameError('Invalid target', 'You cannot protect yourself.');
            }
            if (this.game.lastProtectedPlayer && target === this.game.lastProtectedPlayer) {
                throw new GameError('Invalid target', 'You cannot protect the same player two nights in a row.');
            }
        }

        if (action === 'investigate') {
            if (target === player.id) {
                throw new GameError('Invalid target', 'You cannot investigate yourself.');
            }
        }

        if (action === 'attack') {
            if (target === player.id) {
                throw new GameError('Invalid target', 'You cannot attack yourself.');
            }
        }

        if (action === 'choose_lovers') {
            if (target === player.id) {
                throw new GameError('Invalid target', 'You cannot choose yourself as a lover.');
            }
        }
    }

    /**
     * Handles all night actions such as Werewolf attacks, Seer investigations, Bodyguard protections.
     */
    async handleNightActions() {
        try {
            this.investigationProcessed = false;
            // Clear previous actions first
            this.game.expectedNightActions.clear();
            this.game.nightActions = {};
            this.game.completedNightActions.clear();
            
            // Get all role players first
            const werewolves = this.game.getPlayersByRole(ROLES.WEREWOLF);
            const seer = this.game.getPlayerByRole(ROLES.SEER);
            const bodyguard = this.game.getPlayerByRole(ROLES.BODYGUARD);

            // Add living players to expected actions
            werewolves.forEach(wolf => {
                if (wolf.isAlive) {
                    this.game.expectedNightActions.add(wolf.id);
                }
            });

            if (seer?.isAlive) {
                this.game.expectedNightActions.add(seer.id);
            }

            if (bodyguard?.isAlive) {
                this.game.expectedNightActions.add(bodyguard.id);
                // Send prompt to Bodyguard
                await bodyguard.sendDM({
                    embeds: [{
                        color: 0x4B0082,
                        title: '🛡️ Choose Your Ward',
                        description: 
                            '*Your vigilant eyes scan the village, ready to protect the innocent...*\n\n' +
                            'Use `/action protect` to choose a player to protect tonight.',
                        footer: { text: 'Your shield may mean the difference between life and death...' }
                    }]
                });
            }

            // Send prompts to other roles
            if (seer?.isAlive) {
                await seer.sendDM('Use `/action investigate` to investigate a player tonight.');
            }

            werewolves.forEach(async wolf => {
                if (wolf.isAlive) {
                    await wolf.sendDM({
                        embeds: [{
                            color: 0x800000,
                            title: '🐺 The Hunt Begins',
                            description: 
                                '*Your fangs gleam in the moonlight as you stalk your prey...*\n\n' +
                                'Use `/action attack` to choose your victim tonight.',
                            footer: { text: 'Choose wisely, for the village grows suspicious...' }
                        }]
                    });
                }
            });

            logger.info('Night actions initialized', {
                expectedActions: Array.from(this.game.expectedNightActions)
            });
        } catch (error) {
            logger.error('Error handling night actions', { error });
            throw error;
        }
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
        for (const [playerId, action] of Object.entries(this.game.nightActions)) {
            if (action.action === 'choose_lovers') {
                const cupid = this.game.players.get(playerId);
                const lover = this.game.players.get(action.target);
                
                if (cupid && lover) {
                    // Set up the lover relationship
                    await this.game.processLoverSelection(cupid.id, lover.id);
                    
                    // Notify both players
                    await cupid.sendDM(`You have chosen **${lover.username}** as your lover. If either of you dies, the other will die of heartbreak.`);
                    await lover.sendDM(`**${cupid.username}** has chosen you as their lover. If either of you dies, the other will die of heartbreak.`);
                    
                    logger.info('Cupid chose lover', {
                        cupidId: playerId,
                        cupidName: cupid.username,
                        loverId: action.target,
                        loverName: lover.username
                    });
                }
            }
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

    async processWerewolfAttacks() {
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'attack') {
                    const target = this.game.players.get(action.target);
                    
                    logger.info('Processing werewolf attack', {
                        targetId: action.target,
                        targetRole: target?.role,
                        targetIsAlive: target?.isAlive,
                        targetIsProtected: target?.isProtected
                    });

                    if (!target?.isAlive) {
                        continue;
                    }

                    if (target.isProtected) {
                        // Only send protection message once
                        if (!this.protectionMessageSent) {
                            await this.game.broadcastMessage({
                                embeds: [{
                                    color: 0x4B0082,
                                    title: '🛡️ Protection Prevails',
                                    description: '*The Bodyguard\'s vigilance thwarts the wolves\' attack!*',
                                    footer: { text: 'The village sleeps peacefully...' }
                                }]
                            });
                            this.protectionMessageSent = true;
                        }
                        continue;
                    }

                    // Handle Hunter case
                    if (target.role === ROLES.HUNTER) {
                        this.game.pendingHunterRevenge = target.id;
                        await target.sendDM('You have been eliminated! Use `/action choose_target` to choose someone to take with you.');
                    }

                    target.isAlive = false;
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
                    await this.game.handleLoversDeath(target);
                }
            }
        } catch (error) {
            logger.error('Error processing werewolf attacks', { error });
            // Log error but don't throw - allow phase to continue
        }
    }

    async handleNightZero() {
        try {
            // Clear any existing timeout first
            if (this.game.nightActionTimeout) {
                clearTimeout(this.game.nightActionTimeout);
                this.game.nightActionTimeout = null;
            }

            // Handle Seer's initial revelation
            const seer = this.game.getPlayerByRole(ROLES.SEER);
            if (seer?.isAlive) {
                // Get all players except the seer
                const validTargets = Array.from(this.game.players.values()).filter(
                    p => p.id !== seer.id && p.isAlive
                );
                
                if (validTargets.length > 0) {
                    const randomPlayer = validTargets[Math.floor(Math.random() * validTargets.length)];
                    const isWerewolf = randomPlayer.role === ROLES.WEREWOLF;
                    
                    await seer.sendDM({
                        embeds: [createSeerRevealEmbed(randomPlayer, isWerewolf)]
                    });
                    
                    logger.info('Seer received initial vision', {
                        seerId: seer.id,
                        targetId: randomPlayer.id,
                        isWerewolf: isWerewolf
                    });
                }
            }

            // Only get Cupid for Night Zero
            const cupid = this.game.getPlayerByRole(ROLES.CUPID);
            if (cupid?.isAlive) {
                this.game.expectedNightActions.add(cupid.id);
                await cupid.sendDM('Use `/action choose_lovers` to select your lover. You have 10 minutes.');
                
                // Set new timeout
                this.game.nightActionTimeout = setTimeout(async () => {
                    try {
                        await this.finishNightPhase();
                    } catch (error) {
                        logger.error('Error advancing after Cupid timeout', { error });
                    }
                }, 600000);
            } else {
                await this.finishNightPhase();
            }
        } catch (error) {
            logger.error('Error during Night Zero', { error });
            throw error;
        }
    }

    areAllNightActionsComplete() {
        return Array.from(this.game.expectedNightActions).every(
            playerId => this.game.completedNightActions.has(playerId)
        );
    }
}

module.exports = NightActionProcessor; 