const PHASES = require('../constants/phases');
const ROLES = require('../constants/roles');
const logger = require('../utils/logger');

class GamePhaseManager {
    constructor(game) {
        this.game = game;
        this.expectedActions = new Set();
    }

    async startGame() {
        await this.game.assignRoles();
        await this.handleNightZero();
    }

    async handleNightZero() {
        this.game.phase = PHASES.NIGHT_ZERO;
        
        // Handle Seer's automatic revelation
        const seer = this.game.getPlayerByRole(ROLES.SEER);
        if (seer?.isAlive) {
            await this.handleSeerRevelation(seer);
        }

        // Setup Cupid if present
        const cupid = this.game.getPlayerByRole(ROLES.CUPID);
        if (cupid?.isAlive) {
            await cupid.sendDM('Use `/action choose_lovers` to select two players to be lovers. You have 10 minutes.');
            this.expectedActions.add(cupid.id);
            this.startActionTimer();
        } else {
            // No Cupid or Cupid is dead, advance immediately
            await this.advanceToDay();
        }
    }

    async handleSeerRevelation(seer) {
        const validTargets = Array.from(this.game.players.values()).filter(
            p => p.role !== ROLES.WEREWOLF && 
                 p.id !== seer.id && 
                 p.isAlive
        );
        
        if (validTargets.length > 0) {
            const randomPlayer = validTargets[Math.floor(Math.random() * validTargets.length)];
            await seer.sendDM(`You have been shown that **${randomPlayer.username}** is **Not a Werewolf**.`);
        }
    }

    async handleNightPhase() {
        this.game.phase = PHASES.NIGHT;
        this.expectedActions.clear();

        // Collect expected actions from living players with night actions
        for (const player of this.game.players.values()) {
            if (player.isAlive) {
                switch (player.role) {
                    case ROLES.WEREWOLF:
                    case ROLES.SEER:
                    case ROLES.DOCTOR:
                        this.expectedActions.add(player.id);
                        await this.sendNightActionPrompt(player);
                        break;
                }
            }
        }

        if (this.expectedActions.size === 0) {
            await this.processAndAdvance();
        } else {
            this.startActionTimer();
        }
    }

    async sendNightActionPrompt(player) {
        const prompts = {
            [ROLES.WEREWOLF]: 'Use `/action attack` to choose your victim. You have 10 minutes.',
            [ROLES.SEER]: 'Use `/action investigate` to learn if a player is a werewolf. You have 10 minutes.',
            [ROLES.DOCTOR]: 'Use `/action protect` to save someone from the werewolves. You have 10 minutes.'
        };

        if (prompts[player.role]) {
            await player.sendDM(prompts[player.role]);
        }
    }

    startActionTimer() {
        this.game.nightActionTimeout = setTimeout(() => {
            this.processAndAdvance();
        }, 600000); // 10 minutes
    }

    async processAndAdvance() {
        await this.game.processNightActions();
        if (!this.game.gameOver) {
            await this.game.advanceToDay();
        }
    }

    async handleAction(playerId, action) {
        await this.game.processNightAction(playerId, action);
        
        if (this.expectedActions.has(playerId)) {
            this.expectedActions.delete(playerId);
            
            // If all expected actions received, process and advance
            if (this.expectedActions.size === 0) {
                clearTimeout(this.game.nightActionTimeout);
                await this.processAndAdvance();
            }
        }
    }

    cleanup() {
        if (this.game.nightActionTimeout) {
            clearTimeout(this.game.nightActionTimeout);
            this.game.nightActionTimeout = null;
        }
        this.expectedActions.clear();
    }
}

module.exports = GamePhaseManager;
