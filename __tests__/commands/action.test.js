const { execute } = require('../../commands/action');
const logger = require('../../utils/logger');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');
const actionCommand = require('../../commands/action');

describe('action command', () => {
    let mockInteraction;
    let mockGameInstance;

    beforeEach(() => {
        mockInteraction = {
            guild: null,
            user: { id: '123' },
            options: {
                getString: jest.fn()
            },
            reply: jest.fn()
        };

        mockGameInstance = {
            processNightAction: jest.fn(),
            phase: PHASES.NIGHT,
            round: 1,
            getPlayerById: jest.fn()
        };

        jest.clearAllMocks();
    });

    // Test 1: Successful werewolf attack action
    test('successfully processes werewolf attack action', async () => {
        mockInteraction.options.getString
            .mockReturnValueOnce('attack')
            .mockReturnValueOnce('victim123');

        await execute(mockInteraction, mockGameInstance);

        expect(mockGameInstance.processNightAction).toHaveBeenCalledWith(
            '123',
            'attack',
            'victim123'
        );

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Your action has been recorded. Wait for the night phase to end to see the results.',
            ephemeral: true
        });
    });

    // Test 2: Successful seer investigation
    test('successfully processes seer investigation', async () => {
        mockInteraction.options.getString
            .mockReturnValueOnce('investigate')
            .mockReturnValueOnce('suspect123');

        await execute(mockInteraction, mockGameInstance);

        expect(mockGameInstance.processNightAction).toHaveBeenCalledWith(
            '123',
            'investigate',
            'suspect123'
        );
    });

    // Test 3: Error - Command used in server instead of DM
    test('fails when used outside of DMs', async () => {
        mockInteraction.guild = { id: '456' };
        await execute(mockInteraction, mockGameInstance);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'This command can only be used in direct messages with the bot.',
            ephemeral: true
        });
    });

    // Test 4: Error - No active game
    test('fails when no game is active', async () => {
        mockInteraction.options.getString
            .mockReturnValueOnce('attack')
            .mockReturnValueOnce('victim123');

        await execute(mockInteraction, null);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'You are not part of any ongoing game.',
            ephemeral: true
        });
    });

    // Test 5: Doctor protection action
    test('successfully processes doctor protection action', async () => {
        mockInteraction.options.getString
            .mockReturnValueOnce('protect')
            .mockReturnValueOnce('patient123');

        await execute(mockInteraction, mockGameInstance);

        expect(mockGameInstance.processNightAction).toHaveBeenCalledWith(
            '123',
            'protect',
            'patient123'
        );
    });

    // Test 6: Cupid choosing lovers
    test('successfully processes cupid choosing lovers', async () => {
        mockGameInstance.phase = PHASES.NIGHT_ZERO;
        mockInteraction.options.getString
            .mockReturnValueOnce('choose_lovers')
            .mockReturnValueOnce('lover1,lover2');

        await execute(mockInteraction, mockGameInstance);

        expect(mockGameInstance.processNightAction).toHaveBeenCalledWith(
            '123',
            'choose_lovers',
            'lover1,lover2'
        );
    });

    describe('Night Zero Restrictions', () => {
        beforeEach(() => {
            mockGameInstance.phase = PHASES.NIGHT_ZERO;
            mockGameInstance.round = 0;
        });

        test('prevents Seer from investigating on night zero', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('investigate')
                .mockReturnValueOnce('suspect123');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'The Seer cannot investigate during Night Zero.',
                ephemeral: true
            });
        });

        test('prevents Werewolves from attacking on night zero', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('attack')
                .mockReturnValueOnce('victim123');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Invalid action', 'Werewolves cannot attack during Night Zero.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Werewolves cannot attack during Night Zero.',
                ephemeral: true
            });
        });

        test('allows Cupid to choose lovers only on night zero', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('choose_lovers')
                .mockReturnValueOnce('lover1,lover2');
            
            await execute(mockInteraction, mockGameInstance);

            expect(mockGameInstance.processNightAction).toHaveBeenCalledWith(
                '123',
                'choose_lovers',
                'lover1,lover2'
            );
        });
    });

    describe('Doctor Protection Rules', () => {
        test('prevents protecting the same player two nights in a row', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('protect')
                .mockReturnValueOnce('patient123');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Invalid target', 'You cannot protect the same player two nights in a row.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'You cannot protect the same player two nights in a row.',
                ephemeral: true
            });
        });
    });

    describe('Role Availability Checks', () => {
        test('fails when Cupid tries to act after night zero', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('choose_lovers')
                .mockReturnValueOnce('lover1,lover2');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Invalid action', 'Cupid can only choose lovers during Night Zero.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Cupid can only choose lovers during Night Zero.',
                ephemeral: true
            });
        });

        test('fails when dead Seer tries to investigate', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('investigate')
                .mockReturnValueOnce('suspect123');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Dead player', 'Dead players cannot perform actions.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Dead players cannot perform actions.',
                ephemeral: true
            });
        });

        test('fails when no Doctor exists in game', async () => {
            mockInteraction.options.getString
                .mockReturnValueOnce('protect')
                .mockReturnValueOnce('patient123');
            
            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Not authorized', 'You are not authorized to perform this action.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'You are not authorized to perform this action.',
                ephemeral: true
            });
        });
    });

    describe('Phase Validation', () => {
        test('prevents actions during day phase', async () => {
            mockGameInstance.phase = PHASES.DAY;
            
            mockInteraction.options.getString
                .mockReturnValueOnce('attack')
                .mockReturnValueOnce('victim123');

            mockGameInstance.processNightAction.mockRejectedValue(
                new GameError('Wrong phase', 'Actions can only be performed during the night phase.')
            );

            await execute(mockInteraction, mockGameInstance);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Actions can only be performed during the night phase.',
                ephemeral: true
            });
        });
    });

    describe('autocomplete', () => {
        let mockInteraction;
        let mockGameInstance;

        beforeEach(() => {
            mockInteraction = {
                options: {
                    getFocused: jest.fn().mockReturnValue(''),
                    getString: jest.fn()
                },
                respond: jest.fn(),
                user: { id: 'testUser' }
            };

            mockGameInstance = {
                players: new Map(),
                lastProtectedPlayer: 'lastProtected123'
            };
        });

        test('filters out last protected player for doctor action', async () => {
            // Setup doctor player
            const doctor = {
                id: 'doctor123',
                username: 'Doctor',
                role: ROLES.DOCTOR,
                isAlive: true
            };

            // Setup potential targets
            const targets = [
                { id: 'player1', username: 'Player1', isAlive: true },
                { id: 'lastProtected123', username: 'LastProtected', isAlive: true },
                { id: 'player3', username: 'Player3', isAlive: true }
            ];

            // Add all players to game instance
            mockGameInstance.players.set(doctor.id, doctor);
            targets.forEach(p => mockGameInstance.players.set(p.id, p));

            // Setup interaction options
            mockInteraction.options.getString.mockImplementation(name => {
                if (name === 'action') return 'protect';
                return null;
            });
            mockInteraction.user.id = doctor.id;

            // Execute autocomplete using the imported command
            await actionCommand.autocomplete(mockInteraction, mockGameInstance);

            // Verify response
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'Player1' }),
                    expect.objectContaining({ name: 'Player3' })
                ])
            );

            // Verify last protected player is not included
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.not.arrayContaining([
                    expect.objectContaining({ name: 'LastProtected' })
                ])
            );
        });

        test('includes previously protected player for non-doctor actions', async () => {
            // Setup seer player
            const seer = {
                id: 'seer123',
                username: 'Seer',
                role: ROLES.SEER,
                isAlive: true
            };

            // Setup same targets
            const targets = [
                { id: 'player1', username: 'Player1', isAlive: true },
                { id: 'lastProtected123', username: 'LastProtected', isAlive: true },
                { id: 'player3', username: 'Player3', isAlive: true }
            ];

            mockGameInstance.players.set(seer.id, seer);
            targets.forEach(p => mockGameInstance.players.set(p.id, p));

            mockInteraction.options.getString.mockImplementation(name => {
                if (name === 'action') return 'investigate';
                return null;
            });
            mockInteraction.user.id = seer.id;

            await actionCommand.autocomplete(mockInteraction, mockGameInstance);

            // Verify all living players (except self) are included
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'Player1' }),
                    expect.objectContaining({ name: 'LastProtected' }),
                    expect.objectContaining({ name: 'Player3' })
                ])
            );
        });

        test('filters out dead players for all actions', async () => {
            const doctor = {
                id: 'doctor123',
                username: 'Doctor',
                role: ROLES.DOCTOR,
                isAlive: true
            };

            const targets = [
                { id: 'player1', username: 'Player1', isAlive: true },
                { id: 'player2', username: 'Player2', isAlive: false }, // Dead player
                { id: 'player3', username: 'Player3', isAlive: true }
            ];

            mockGameInstance.players.set(doctor.id, doctor);
            targets.forEach(p => mockGameInstance.players.set(p.id, p));

            mockInteraction.options.getString.mockImplementation(name => {
                if (name === 'action') return 'protect';
                return null;
            });
            mockInteraction.user.id = doctor.id;

            await actionCommand.autocomplete(mockInteraction, mockGameInstance);

            // Verify dead player is not included
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                expect.not.arrayContaining([
                    expect.objectContaining({ name: 'Player2' })
                ])
            );
        });
    });
});
