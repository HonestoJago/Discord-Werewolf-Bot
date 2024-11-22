const { GameError } = require('./error-handler');

class InputValidator {
    static validatePlayerAction(action, allowedActions) {
        if (!allowedActions.includes(action)) {
            throw new GameError('Invalid action', 'This action is not allowed.');
        }
    }

    static validatePlayerId(playerId, players) {
        if (!players.has(playerId)) {
            throw new GameError('Invalid player', 'Player not found in game.');
        }
    }

    static validatePhaseAction(currentPhase, allowedPhases) {
        if (!allowedPhases.includes(currentPhase)) {
            throw new GameError('Invalid phase', 'This action cannot be performed in the current phase.');
        }
    }

    static validateMessage(message) {
        if (typeof message !== 'string') {
            throw new GameError('Invalid message', 'Message must be a string.');
        }
        if (message.length > 2000) {
            throw new GameError('Message too long', 'Message must be under 2000 characters.');
        }
        if (/<script|javascript:|data:/i.test(message)) {
            throw new GameError('Invalid content', 'Message contains forbidden content.');
        }
    }
}

module.exports = InputValidator; 