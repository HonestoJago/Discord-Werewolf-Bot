const WerewolfGame = require('../game/WerewolfGame');
const logger = require('./logger');
const Game = require('../models/Game');

class GameManager {
    static async createGame(client, guildId, channelId, creatorId) {
        try {
            logger.info('Creating new game instance', {
                guildId,
                channelId,
                creatorId
            });

            const game = await WerewolfGame.create(
                client,
                guildId,
                channelId,
                creatorId
            );

            client.games.set(guildId, game);

            logger.info('Game instance created successfully', {
                guildId,
                phase: game.phase
            });

            return game;
        } catch (error) {
            logger.error('Error creating new game', {
                error,
                guildId
            });
            throw error;
        }
    }

    static async cleanupGame(client, guildId) {
        try {
            const game = client.games.get(guildId);
            if (game) {
                await game.shutdownGame();
                client.games.delete(guildId);
                
                await Game.destroy({ 
                    where: { guildId: guildId }
                });
                
                logger.info('Game cleaned up successfully', { 
                    guildId,
                    cleanedFromDB: true 
                });
            }
        } catch (error) {
            logger.error('Error cleaning up game', {
                error,
                guildId
            });
            throw error;
        }
    }
}

module.exports = GameManager; 