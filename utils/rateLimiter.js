const { RateLimit } = require('./database');
const { GameError } = require('./error-handler');
const logger = require('./logger');
const { Op } = require('sequelize');

class RateLimiter {
    constructor() {
        this.COOLDOWN_TIMES = {
            vote: 1000,      // 1 second between votes
            nominate: 2000,  // 2 seconds between nominations
            action: 1000,    // 1 second between night actions
            join: 100,       // 100ms between join attempts (essentially no limit)
            ready: 500       // 0.5 seconds between ready toggles
        };
    }

    async checkRateLimit(playerId, actionType) {
        const key = `${playerId}-${actionType}`;
        const cooldownTime = this.COOLDOWN_TIMES[actionType];

        try {
            // First cleanup any old rate limits for this player
            await RateLimit.destroy({
                where: {
                    key: {
                        [Op.like]: `${playerId}-%`
                    },
                    last_action: {
                        [Op.lt]: new Date(Date.now() - 60000) // Clear limits older than 1 minute
                    }
                }
            });

            const [rateLimit] = await RateLimit.findOrCreate({
                where: { key },
                defaults: {
                    lastAction: new Date(),
                    actionCount: 1
                }
            });

            const timeSinceLastAction = Date.now() - rateLimit.lastAction.getTime();

            // For join actions, only rate limit if there are too many attempts
            if (actionType === 'join' && rateLimit.actionCount <= 3) {
                // Allow first 3 join attempts without delay
                rateLimit.actionCount++;
                rateLimit.lastAction = new Date();
                await rateLimit.save();
                return true;
            }

            if (timeSinceLastAction < cooldownTime) {
                const remainingTime = Math.ceil((cooldownTime - timeSinceLastAction)/1000);
                logger.warn('Rate limit hit', {
                    playerId,
                    actionType,
                    remainingTime,
                    actionCount: rateLimit.actionCount
                });
                
                // Increment action count to track potential abuse
                await rateLimit.increment('actionCount');
                
                throw new GameError('Rate limited', 
                    `Please wait ${remainingTime} seconds before trying again.`);
            }

            // Reset counter if enough time has passed
            if (timeSinceLastAction > cooldownTime * 5) {
                rateLimit.actionCount = 1;
            } else {
                await rateLimit.increment('actionCount');
            }

            rateLimit.lastAction = new Date();
            await rateLimit.save();

            return true;
        } catch (error) {
            if (error instanceof GameError) throw error;
            logger.error('Database error in rate limiter', { error });
            // Allow action if database fails
            return true;
        }
    }

    async clearPlayerLimits(playerId) {
        try {
            await RateLimit.destroy({
                where: {
                    key: {
                        [Op.like]: `${playerId}-%`
                    }
                }
            });
        } catch (error) {
            logger.error('Error clearing rate limits', { error, playerId });
        }
    }
}

module.exports = RateLimiter; 