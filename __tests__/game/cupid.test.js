const { createMockClient } = require('../helpers/discordMocks');
const WerewolfGame = require('../../game/WerewolfGame');
const NightActionProcessor = require('../../game/NightActionProcessor');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');
const { GameError } = require('../../utils/error-handler');

describe('Cupid Functionality', () => {
    let game;
    let mockClient;
    let cupid;
    let lover;
    let nightProcessor;

    beforeEach(() => {
        mockClient = createMockClient();
        game = new WerewolfGame(mockClient, 'testGuild', 'testChannel', 'creatorId');
        nightProcessor = new NightActionProcessor(game);

        // Create test players
        cupid = {
            id: 'cupidId',
            username: 'cupid',
            role: ROLES.CUPID,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        lover = {
            id: 'loverId',
            username: 'lover',
            role: ROLES.VILLAGER,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        // Add players to game
        game.players.set(cupid.id, cupid);
        game.players.set(lover.id, lover);

        // Set game phase
        game.phase = PHASES.NIGHT_ZERO;
        game.broadcastMessage = jest.fn().mockResolvedValue(true);
        game.processLoverSelection = jest.fn().mockResolvedValue(true);

        // Setup night action tracking
        game.expectedNightActions = new Set([cupid.id]);
        game.completedNightActions = new Set();
    });

    describe('Lover Selection', () => {
        test('successfully selects lover', async () => {
            game.nightActions = {
                [cupid.id]: { action: 'choose_lovers', target: lover.id }
            };

            await nightProcessor.processCupidAction();

            expect(game.processLoverSelection).toHaveBeenCalledWith(cupid.id, lover.id);
            expect(cupid.sendDM).toHaveBeenCalledWith(
                expect.stringContaining(`You have chosen **${lover.username}** as your lover`)
            );
            expect(lover.sendDM).toHaveBeenCalledWith(
                expect.stringContaining(`**${cupid.username}** has chosen you as their lover`)
            );
        });

        test('cannot select self as lover', async () => {
            await expect(nightProcessor.processNightAction(
                cupid.id,
                'choose_lovers',
                cupid.id
            )).rejects.toThrow('Invalid target');
        });

        test('can only choose lover during Night Zero', async () => {
            game.phase = PHASES.NIGHT;
            
            await expect(nightProcessor.processNightAction(
                cupid.id,
                'choose_lovers',
                lover.id
            )).rejects.toThrow('Invalid phase');
        });

        test('cannot choose dead player as lover', async () => {
            lover.isAlive = false;
            
            await expect(nightProcessor.processNightAction(
                cupid.id,
                'choose_lovers',
                lover.id
            )).rejects.toThrow('Invalid target');
        });
    });

    describe('Death Chain Reaction', () => {
        beforeEach(() => {
            // Initialize the lovers Map if it doesn't exist
            game.lovers = game.lovers || new Map();
        });

        test('lover dies when Cupid dies', async () => {
            // Set up the lover relationship
            game.lovers.set(cupid.id, lover.id);
            game.lovers.set(lover.id, cupid.id);
            
            // Kill Cupid
            cupid.isAlive = false;
            await game.handleLoversDeath(cupid);

            expect(lover.isAlive).toBe(false);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.stringContaining(`**${lover.username}** has died of heartbreak`)
            );
        });

        test('Cupid dies when lover dies', async () => {
            // Set up the lover relationship
            game.lovers.set(cupid.id, lover.id);
            game.lovers.set(lover.id, cupid.id);
            
            // Kill lover
            lover.isAlive = false;
            await game.handleLoversDeath(lover);

            expect(cupid.isAlive).toBe(false);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.stringContaining(`**${cupid.username}** has died of heartbreak`)
            );
        });
    });

    describe('Edge Cases', () => {
        test('handles disconnected player during lover selection', async () => {
            // Mock sendDM to throw a GameError
            lover.sendDM = jest.fn().mockImplementation(() => {
                throw new GameError('DM Failed', 'Failed to send direct message to player.');
            });

            game.nightActions = {
                [cupid.id]: { action: 'choose_lovers', target: lover.id }
            };

            await expect(nightProcessor.processCupidAction())
                .rejects.toThrow(GameError);
        });

        test('only Cupid can use choose_lovers action', async () => {
            await expect(nightProcessor.processNightAction(
                lover.id,
                'choose_lovers',
                cupid.id
            )).rejects.toThrow('Invalid role');
        });
    });
}); 