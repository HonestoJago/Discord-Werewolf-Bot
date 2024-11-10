const { createMockInteraction, createMockClient } = require('../helpers/discordMocks');
const { GameError } = require('../../utils/error-handler');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');
const actionCommand = require('../../commands/action');

describe('Action Command', () => {
    let mockInteraction;
    let mockGame;
    let mockPlayer;

    beforeEach(() => {
        // Setup basic mock player
        mockPlayer = {
            id: 'testPlayerId',
            username: 'testPlayer',
            role: ROLES.WEREWOLF,
            isAlive: true
        };

        // Setup mock game with proper night action tracking
        mockGame = {
            phase: PHASES.NIGHT,
            players: new Map([['testPlayerId', mockPlayer]]),
            processNightAction: jest.fn().mockResolvedValue(true),
            voteProcessor: {
                processHunterRevenge: jest.fn().mockResolvedValue(true)
            },
            expectedNightActions: new Set(['testPlayerId']),
            completedNightActions: new Set()
        };

        // Add target player to game's players Map
        mockGame.players.set('targetId', {
            id: 'targetId',
            username: 'target',
            role: ROLES.VILLAGER,
            isAlive: true
        });

        // Setup mock interaction
        mockInteraction = createMockInteraction({
            options: {
                getString: jest.fn(param => {
                    if (param === 'action') return 'attack';
                    if (param === 'target') return 'targetId';
                    return null;
                }),
                getFocused: jest.fn().mockReturnValue('')
            },
            guild: null,  // Simulating DM
            user: { id: 'testPlayerId' },
            reply: jest.fn().mockResolvedValue(true),
            client: { 
                games: new Map() 
            }
        });
    });

    describe('execute', () => {
        test('rejects when no game is found', async () => {
            await actionCommand.execute(mockInteraction, null);
            
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'You are not part of any ongoing game.',
                ephemeral: true
            });
        });

        test('successfully processes werewolf attack', async () => {
            await actionCommand.execute(mockInteraction, mockGame);
            
            expect(mockGame.processNightAction).toHaveBeenCalledWith(
                'testPlayerId',
                'attack',
                'targetId'
            );
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: expect.stringContaining('action has been recorded'),
                ephemeral: true
            });
        });

        test('handles invalid target', async () => {
            mockGame.processNightAction.mockRejectedValueOnce(
                new GameError('Invalid target', 'The selected target is not valid.')
            );

            await actionCommand.execute(mockInteraction, mockGame);
            
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'The selected target is not valid.',
                ephemeral: true
            });
        });

        test('successfully processes hunter revenge', async () => {
            // Setup hunter-specific mocks
            mockPlayer.role = ROLES.HUNTER;
            mockGame.pendingHunterRevenge = 'testPlayerId';

            // Make sure getString returns the right values for Hunter revenge
            mockInteraction.options.getString = jest.fn(param => {
                if (param === 'action') return 'choose_target';
                if (param === 'target') return 'targetId';
                return null;
            });

            await actionCommand.execute(mockInteraction, mockGame);

            expect(mockGame.voteProcessor.processHunterRevenge).toHaveBeenCalledWith(
                'testPlayerId',
                'targetId'
            );
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Your revenge has been executed.',
                ephemeral: true
            });
        });
    });

    describe('autocomplete', () => {
        beforeEach(() => {
            mockGame.players.set('targetId', {
                id: 'targetId',
                username: 'target',
                role: ROLES.VILLAGER,
                isAlive: true
            });
        });

        test('returns empty array when no game found', async () => {
            await actionCommand.autocomplete(mockInteraction, null);
            expect(mockInteraction.respond).toHaveBeenCalledWith([]);
        });

        test('filters werewolf targets correctly', async () => {
            mockPlayer.role = ROLES.WEREWOLF;
            mockGame.players.set('targetId', {
                id: 'targetId',
                username: 'target',
                role: ROLES.VILLAGER,
                isAlive: true
            });

            await actionCommand.autocomplete(mockInteraction, mockGame);
            
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'target',
                        value: 'targetId'
                    })
                ])
            );
        });

        test('filters seer targets correctly', async () => {
            mockPlayer.role = ROLES.SEER;
            mockInteraction.options.getString
                .mockImplementation(param => param === 'action' ? 'investigate' : null);

            mockGame.players.set('targetId', {
                id: 'targetId',
                username: 'target',
                isAlive: true
            });

            await actionCommand.autocomplete(mockInteraction, mockGame);
            
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'target',
                        value: 'targetId'
                    })
                ])
            );
        });

        test('handles invalid action type', async () => {
            mockInteraction.options.getString
                .mockImplementation(param => param === 'action' ? 'invalid' : null);

            await actionCommand.autocomplete(mockInteraction, mockGame);
            
            expect(mockInteraction.respond).toHaveBeenCalledWith([]);
        });

        test('filters targets based on focused value', async () => {
            mockInteraction.options.getFocused.mockReturnValue('tar');
            mockGame.players.set('targetId', {
                id: 'targetId',
                username: 'target',
                isAlive: true
            });
            mockGame.players.set('otherId', {
                id: 'otherId',
                username: 'other',
                isAlive: true
            });

            await actionCommand.autocomplete(mockInteraction, mockGame);
            
            const response = mockInteraction.respond.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0].name).toBe('target');
        });
    });
}); 