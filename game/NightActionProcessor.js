const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');

class NightActionProcessor {
    constructor(game) {
        this.game = game;
    }

    async processNightAction(playerId, action, target) {
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
            return await this.processHunterRevenge(player, target);
        }

        // Regular night action validation
        if (!player.isAlive) {
            throw new GameError('Dead players cannot perform actions', 'Dead players cannot perform actions.');
        }

        if (this.game.phase !== PHASES.NIGHT && this.game.phase !== PHASES.NIGHT_ZERO) {
            throw new GameError('Wrong phase', 'Night actions can only be performed during night phases');
        }

        // Validate target exists and is alive
        const targetPlayer = this.game.players.get(target);
        if (!targetPlayer || !targetPlayer.isAlive) {
            throw new GameError('Invalid target', 'Target player not found or is dead');
        }

        // Validate action based on phase and role
        this.validateNightAction(player, action, target);

        // Store the action
        this.game.nightActions[playerId] = { action, target };
        this.game.completedNightActions.add(playerId);

        logger.info('Night action collected', { playerId, action, target });
    }

    async processNightActions() {
        try {
            logger.info('Starting to process night actions', {
                nightActions: this.game.nightActions,
                expectedNightActions: Array.from(this.game.expectedNightActions)
            });

            if (this.game.nightActionTimeout) {
                clearTimeout(this.game.nightActionTimeout);
                this.game.nightActionTimeout = null;
            }

            // Process Cupid's action first during Night Zero
            if (this.game.phase === PHASES.NIGHT_ZERO) {
                for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                    if (action.action === 'choose_lovers') {
                        const cupid = this.game.players.get(playerId);
                        const target = this.game.players.get(action.target);
                        
                        // Set up bidirectional lover relationship
                        await this.game.processLoverSelection(playerId, action.target);
                        
                        logger.info('Cupid chose lover', {
                            cupidId: playerId,
                            cupidName: cupid.username,
                            loverId: action.target,
                            loverName: target.username,
                            loversMap: Array.from(this.game.lovers.entries())
                        });
                    }
                }
            }

            await this.processBodyguardProtection();

            // Process Werewolf attacks
            let hunterRevengeTriggered = false;
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'attack') {
                    const target = this.game.players.get(action.target);
                    
                    // Add logging for attack processing
                    logger.info('Processing werewolf attack', {
                        targetId: action.target,
                        targetRole: target?.role,
                        targetIsAlive: target?.isAlive,
                        targetIsProtected: target?.isProtected
                    });

                    if (target?.isAlive && !target.isProtected) {
                        if (target.role === ROLES.HUNTER) {
                            logger.info('Hunter was attacked', {
                                hunterId: target.id,
                                hunterName: target.username
                            });

                            // Clear any existing night action timeout
                            if (this.game.nightActionTimeout) {
                                clearTimeout(this.game.nightActionTimeout);
                            }

                            // Set up Hunter's revenge
                            this.game.pendingHunterRevenge = target.id;
                            this.game.expectedNightActions.clear();  // Clear other expected actions
                            this.game.expectedNightActions.add(target.id);
                            hunterRevengeTriggered = true;

                            // Send DM to Hunter
                            await target.sendDM('You have been eliminated! Use `/action choose_target` to choose someone to take with you.');
                            
                            // Broadcast attack
                            await this.game.broadcastMessage(`**${target.username}** was attacked during the night!`);

                            logger.info('Hunter revenge state set', {
                                pendingHunterRevenge: this.game.pendingHunterRevenge,
                                expectedNightActions: Array.from(this.game.expectedNightActions),
                                hunterRevengeTriggered
                            });

                            // Stop processing other actions
                            break;
                        } else {
                            target.isAlive = false;
                            await this.game.broadcastMessage(`**${target.username}** was killed during the night.`);
                            await this.game.moveToDeadChannel(target);
                            await this.game.handleLoversDeath(target);
                        }
                    }
                }
            }

            // If Hunter revenge was triggered, set timeout and return
            if (hunterRevengeTriggered) {
                this.game.nightActionTimeout = setTimeout(() => {
                    this.finishNightPhase();
                }, 300000); // 5 minutes
                return;
            }

            // If no Hunter revenge, finish night phase normally
            await this.finishNightPhase();

        } catch (error) {
            logger.error('Error processing night actions', { error });
            throw error;
        }
    }

    async processBodyguardProtection() {
        for (const [playerId, action] of Object.entries(this.game.nightActions)) {
            if (action.action === 'protect') {
                const target = this.game.players.get(action.target);
                if (target) {
                    target.isProtected = true;
                    logger.info('Bodyguard protected player', { targetId: target.id });
                }
            }
        }
    }

    async processSeerInvestigations() {
        for (const [playerId, action] of Object.entries(this.game.nightActions)) {
            if (action.action === 'investigate') {
                const seer = this.game.players.get(playerId);
                const target = this.game.players.get(action.target);
                if (seer?.isAlive && target) {
                    const isWerewolf = target.role === ROLES.WEREWOLF;
                    await seer.sendDM(`Your investigation reveals that **${target.username}** is **${isWerewolf ? 'a Werewolf' : 'Not a Werewolf'}**.`);
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

        // 3. Process Seer investigations
        await this.processSeerInvestigations();

        // Reset protections
        for (const player of this.game.players.values()) {
            player.isProtected = false;
        }

        // Check win conditions before advancing
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToDay();
        }
    }

    validateNightAction(player, action, target) {
        // Check if player has already acted
        if (this.game.completedNightActions.has(player.id)) {
            throw new GameError(
                'Action already performed',
                'You have already performed your night action.'
            );
        }

        // Special case for Hunter's revenge - skip other validations
        if ((action === 'choose_target' || action === 'hunter_revenge') && 
            player.id === this.game.pendingHunterRevenge) {
            return;
        }

        // Check if player is expected to act
        if (!this.game.expectedNightActions.has(player.id)) {
            throw new GameError(
                'Unexpected action',
                'You are not expected to perform any action at this time.'
            );
        }

        // Role-specific validations
        switch(action) {
            case 'protect':
                if (player.role !== ROLES.BODYGUARD) {
                    throw new GameError('Invalid role', 'Only the Bodyguard can protect players.');
                }
                if (target === this.game.lastProtectedPlayer) {
                    throw new GameError('Invalid target', 'You cannot protect the same player two nights in a row.');
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
            case 'choose_lovers':
                if (player.role !== ROLES.CUPID || this.game.phase !== PHASES.NIGHT_ZERO) {
                    throw new GameError('Invalid action', 'Only Cupid can choose lovers during Night Zero.');
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
    }
}

module.exports = NightActionProcessor; 