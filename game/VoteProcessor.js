const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createVoteResultsEmbed } = require('../utils/embedCreator');

class VoteProcessor {
    constructor(game) {
        this.game = game;
    }

    async processVotes() {
        if (!this.game.votingOpen) {
            throw new GameError('Invalid state', 'No votes to process.');
        }
    
        const voteCounts = {
            guilty: 0,
            innocent: 0
        };
    
        const playerVotes = {};
        const target = this.game.players.get(this.game.nominatedPlayer);
        
        // Count votes only from living players who aren't the target
        const eligibleVoters = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== this.game.nominatedPlayer);
        
        // Calculate votes
        for (const [voterId, vote] of this.game.votes.entries()) {
            const voter = this.game.players.get(voterId);
            if (voter && voter.isAlive && voterId !== this.game.nominatedPlayer) {
                voteCounts[vote ? 'guilty' : 'innocent']++;
                playerVotes[voter.username] = vote;
            }
        }
    
        // Check if we have all eligible votes
        const totalVotes = voteCounts.guilty + voteCounts.innocent;
        const expectedVotes = eligibleVoters.length;
        
        // If we don't have all votes yet, don't process the result
        if (totalVotes < expectedVotes) {
            return null;
        }
    
        const eliminated = voteCounts.guilty > voteCounts.innocent;
    
        // Create and send results embed
        const resultsEmbed = createVoteResultsEmbed(
            target,
            voteCounts,
            eliminated,
            playerVotes
        );
    
        const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
        await channel.send({ embeds: [resultsEmbed] });
    
        if (eliminated) {
            // Announce whether the eliminated player was a werewolf
            const isWerewolf = target.role === ROLES.WEREWOLF;
            await this.game.broadcastMessage({
                embeds: [{
                    color: isWerewolf ? 0x008000 : 0x800000, // Green for werewolf, red for non-werewolf
                    title: isWerewolf ? '🐺 A Wolf Among Us!' : '❌ An Innocent Soul',
                    description: isWerewolf ?
                        `*The village's suspicions were correct! **${target.username}** was indeed a Werewolf!*` :
                        `*Alas, **${target.username}** was not a Werewolf. The real beasts still lurk among you...*`,
                    footer: { text: isWerewolf ? 'But are there more?' : 'Choose more carefully next time...' }
                }]
            });

            // Handle Hunter's revenge BEFORE marking as dead
            if (target.role === ROLES.HUNTER) {
                logger.info('Hunter was voted out', {
                    hunterId: target.id,
                    hunterName: target.username
                });

                // Set up Hunter's revenge state
                this.game.pendingHunterRevenge = target.id;
                
                // Send DM to Hunter before marking as dead
                await target.sendDM('You have been eliminated! Use `/action choose_target` to choose someone to take with you.');
                
                // Set timeout for Hunter's revenge
                const hunterTimeout = setTimeout(async () => {
                    if (this.game.pendingHunterRevenge) {
                        target.isAlive = false;
                        await this.game.broadcastMessage(`**${target.username}** has been eliminated!`);
                        await this.game.moveToDeadChannel(target);
                        await this.game.handleLoversDeath(target);
                        this.game.pendingHunterRevenge = null;
                        
                        if (!this.game.checkWinConditions()) {
                            await this.game.advanceToNight();
                        }
                    }
                }, 300000); // 5 minutes

                // Clear voting state but stay in day phase
                this.game.clearVotingState();
                return;
            }

            // For non-Hunter players, mark as dead first, then handle effects
            target.isAlive = false;
            await this.game.broadcastMessage(`**${target.username}** has been eliminated!`);
            await this.game.moveToDeadChannel(target);
            await this.game.handleLoversDeath(target);

            // Check win conditions before advancing
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToNight();
            }
        } else {
            // If no elimination (tie or majority innocent), stay in day phase
            await this.game.broadcastMessage('No player was eliminated. The voting continues...');
            
            // Refresh the day phase UI
            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            await dayPhaseHandler.createDayPhaseUI(channel, this.game.players);
        }
    
        // Reset voting state
        this.game.clearVotingState();
    
        return {
            eliminated: eliminated ? target.id : null,
            votesFor: voteCounts.guilty,
            votesAgainst: voteCounts.innocent,
            stayInDay: !eliminated
        };
    }

    // Add method to handle Hunter's revenge during day
    async processHunterRevenge(hunterId, targetId) {
        const hunter = this.game.players.get(hunterId);
        const target = this.game.players.get(targetId);

        if (!this.game.pendingHunterRevenge || hunterId !== this.game.pendingHunterRevenge) {
            throw new GameError('Invalid action', 'You can only use this action when prompted after being eliminated as the Hunter.');
        }

        if (!target?.isAlive) {
            throw new GameError('Invalid target', 'You must choose a living player.');
        }

        // Mark both players as dead
        hunter.isAlive = false;
        target.isAlive = false;

        // Broadcast the revenge
        await this.game.broadcastMessage({
            embeds: [{
                color: 0x800000,
                title: '🏹 The Hunter\'s Final Shot',
                description: 
                    `*With their dying breath, **${hunter.username}** raises their bow...*\n\n` +
                    `In a final act of vengeance, they take **${target.username}** with them to the grave!`,
                footer: { text: 'Even in death, the Hunter\'s aim remains true...' }
            }]
        });
        
        // Move both to dead channel
        await this.game.moveToDeadChannel(hunter);
        await this.game.moveToDeadChannel(target);
        
        // Handle any lover deaths
        await this.game.handleLoversDeath(target);
        
        // Clear the pending state
        this.game.pendingHunterRevenge = null;

        // Check win conditions before advancing to night
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToNight();
        }
    }
}

module.exports = VoteProcessor; 