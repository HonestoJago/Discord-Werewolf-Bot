const { execute } = require('../../commands/action');
const logger = require('../../utils/logger');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

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
});
