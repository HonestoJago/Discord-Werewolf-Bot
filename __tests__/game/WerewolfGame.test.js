const WerewolfGame = require('../../game/WerewolfGame');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('WerewolfGame night action processing', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            channels: {
                fetch: jest.fn()
            },
            users: {
                fetch: jest.fn()
            }
        };
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        game.players = new Map(); // Initialize players Map
        game.nightActions = {}; // Initialize nightActions object
    });

    describe('processNightAction', () => {
        test('validates player existence', async () => {
            await expect(async () => {
                await game.processNightAction('nonexistent', 'attack', 'target');
            }).rejects.toThrow(new GameError('Not authorized', 'You are not authorized to perform this action.'));
        });

        test('validates player is alive', async () => {
            game.players.set('dead123', {
                id: 'dead123',
                isAlive: false,
                role: ROLES.WEREWOLF
            });

            await expect(async () => {
                await game.processNightAction('dead123', 'attack', 'target');
            }).rejects.toThrow(new GameError('Dead player', 'Dead players cannot perform actions.'));
        });

        test('validates day phase restriction', async () => {
            game.phase = PHASES.DAY;
            game.players.set('player123', {
                id: 'player123',
                isAlive: true,
                role: ROLES.WEREWOLF
            });

            await expect(async () => {
                await game.processNightAction('player123', 'attack', 'target');
            }).rejects.toThrow(new GameError('Wrong phase', 'Actions can only be performed during the night phase.'));
        });

        test('successfully processes valid action', async () => {
            game.phase = PHASES.NIGHT;
            game.players.set('player123', {
                id: 'player123',
                isAlive: true,
                role: ROLES.WEREWOLF
            });

            await game.processNightAction('player123', 'attack', 'target');
            
            // Verify action was stored
            expect(game.nightActions['player123']).toEqual({
                action: 'attack',
                target: 'target'
            });
        });
    });

    describe('validateNightAction', () => {
        test('validates Seer night zero restriction', () => {
            game.phase = PHASES.NIGHT_ZERO;
            const player = { role: ROLES.SEER, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'investigate', 'target');
            }).toThrow(new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.'));
        });

        test('validates Werewolf night zero restriction', () => {
            game.phase = PHASES.NIGHT_ZERO;
            const player = { role: ROLES.WEREWOLF, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'attack', 'target');
            }).toThrow(new GameError('Invalid action', 'Werewolves cannot attack during Night Zero.'));
        });

        test('validates Cupid can only act during night zero', () => {
            game.phase = PHASES.NIGHT;
            const player = { role: ROLES.CUPID, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'choose_lovers', 'lover1,lover2');
            }).toThrow(new GameError('Invalid action', 'Cupid can only choose lovers during Night Zero.'));
        });

        test('validates Doctor consecutive protection rule', () => {
            game.phase = PHASES.NIGHT;
            const player = { role: ROLES.DOCTOR, isAlive: true };
            game.lastProtectedPlayer = 'target';

            expect(() => {
                game.validateNightAction(player, 'protect', 'target');
            }).toThrow(new GameError('Invalid target', 'You cannot protect the same player two nights in a row.'));
        });

        test('validates role-specific actions', () => {
            game.phase = PHASES.NIGHT;
            const player = { role: ROLES.VILLAGER, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'investigate', 'target');
            }).toThrow(new GameError('Invalid role', 'Only the Seer can investigate players.'));
        });

        test('validates target is provided', () => {
            game.phase = PHASES.NIGHT;
            const player = { role: ROLES.WEREWOLF, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'attack', '');
            }).toThrow(new GameError('Invalid target', 'You must specify a target for your action.'));
        });

        test('validates action type', () => {
            game.phase = PHASES.NIGHT;
            const player = { role: ROLES.WEREWOLF, isAlive: true };

            expect(() => {
                game.validateNightAction(player, 'invalid_action', 'target');
            }).toThrow(new GameError('Invalid action', 'Unknown action type.'));
        });

        // Add more validation tests
    });

    describe('collectNightAction', () => {
        test('collects and stores night action', async () => {
            const playerId = 'player123';
            const action = 'attack';
            const target = 'target123';
            
            // Add a valid player to the game
            game.players.set(playerId, {
                id: playerId,
                isAlive: true,
                role: ROLES.WEREWOLF
            });
            
            // Process the action
            await game.processNightAction(playerId, action, target);
            
            // Verify action was stored
            expect(game.nightActions[playerId]).toEqual({
                action,
                target
            });
        });
    });
});
