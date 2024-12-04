const { SecurityLog } = require('./database');
const { Op } = require('sequelize');
const logger = require('./logger');

class SecurityManager {
    constructor(gameId) {
        this.gameId = gameId;
        this.SUSPICIOUS_THRESHOLDS = {
            rapidActions: 5,
            roleGuesses: 0.8,
            votePatterns: 0.9
        };
    }

    async logAction(playerId, actionType, actionData = {}) {
        try {
            // Log the action
            await SecurityLog.create({
                playerId,
                gameId: this.gameId,
                actionType,
                actionData,
                timestamp: new Date()
            });

            // Check recent actions for suspicious patterns
            const recentActions = await SecurityLog.findAll({
                where: {
                    playerId,
                    gameId: this.gameId,
                    timestamp: {
                        [Op.gte]: new Date(Date.now() - 60000) // Last minute
                    }
                }
            });

            await this.checkForSuspiciousActivity(playerId, recentActions);

        } catch (error) {
            logger.error('Error logging security action', { 
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                playerId,
                actionType,
                actionData
            });
        }
    }

    async checkForSuspiciousActivity(playerId, recentActions) {
        // Check action frequency
        if (recentActions.length > this.SUSPICIOUS_THRESHOLDS.rapidActions) {
            this.flagSuspiciousActivity(playerId, 'rapid_actions', {
                actionCount: recentActions.length,
                timeWindow: '60s'
            });
        }

        // Check vote patterns
        const voteActions = recentActions.filter(a => a.type === 'vote');
        if (voteActions.length >= 3) {
            const alignedVotes = this.checkVoteAlignment(voteActions);
            if (alignedVotes > this.SUSPICIOUS_THRESHOLDS.votePatterns) {
                this.flagSuspiciousActivity(playerId, 'vote_pattern', {
                    alignment: alignedVotes,
                    voteCount: voteActions.length
                });
            }
        }
    }

    checkVoteAlignment(votes) {
        // Calculate how often a player votes with specific other players
        // Returns highest alignment percentage
        return 0; // Implement actual vote pattern analysis
    }

    flagSuspiciousActivity(playerId, reason, data) {
        logger.warn('Suspicious activity detected', {
            gameId: this.gameId,
            playerId,
            reason,
            data,
            timestamp: new Date().toISOString()
        });
        // Could implement webhook notifications to a moderation channel
    }

    clearPlayerHistory(playerId) {
        this.actionLog.delete(playerId);
    }
}

module.exports = SecurityManager; 