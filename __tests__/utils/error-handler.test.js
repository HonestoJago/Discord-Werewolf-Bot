// Mock logger
jest.mock('../../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
}));

const { GameError, handleCommandError } = require('../../utils/error-handler');
const logger = require('../../utils/logger');

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

describe('GameError', () => {
    test('creates error with message and user message', () => {
        const error = new GameError('Internal error', 'User friendly message');
        expect(error.message).toBe('Internal error');
        expect(error.userMessage).toBe('User friendly message');
        expect(error instanceof Error).toBe(true);
        expect(error.name).toBe('GameError');
    });

    test('defaults userMessage to message if not provided', () => {
        const error = new GameError('Some error');
        expect(error.message).toBe('Some error');
        expect(error.userMessage).toBe('Some error');
    });

    test('maintains stack trace', () => {
        const error = new GameError('Test error');
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain('GameError');
    });
});

describe('handleCommandError', () => {
    let mockInteraction;

    beforeEach(() => {
        mockInteraction = {
            reply: jest.fn().mockResolvedValue(undefined),
            followUp: jest.fn().mockResolvedValue(undefined),
            deferred: false,
            replied: false,
            commandName: 'testCommand',
            user: { id: 'userId' },
            guild: { id: 'guildId' }
        };
    });

    test('handles GameError with custom user message', async () => {
        const error = new GameError('Internal error', 'User friendly message');
        await handleCommandError(mockInteraction, error);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'User friendly message',
            ephemeral: true
        });
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                commandName: 'testCommand',
                userId: 'userId',
                guildId: 'guildId',
                error: 'Internal error'
            }),
            'Game error in command execution'
        );
    });

    test('handles generic Error with error ID', async () => {
        const error = new Error('Something went wrong');
        await handleCommandError(mockInteraction, error);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('Error ID:'),
            ephemeral: true
        });
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                commandName: 'testCommand',
                userId: 'userId',
                guildId: 'guildId',
                error: expect.any(String)
            }),
            'Unexpected error in command execution'
        );
    });

    test('uses followUp if interaction already replied', async () => {
        mockInteraction.replied = true;
        const error = new Error('Test error');

        await handleCommandError(mockInteraction, error);

        expect(mockInteraction.followUp).toHaveBeenCalled();
        expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    test('uses followUp if interaction is deferred', async () => {
        mockInteraction.deferred = true;
        const error = new Error('Test error');

        await handleCommandError(mockInteraction, error);

        expect(mockInteraction.followUp).toHaveBeenCalled();
        expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    test('handles reply failure gracefully', async () => {
        mockInteraction.reply.mockRejectedValue(new Error('Reply failed'));
        const error = new Error('Original error');

        await handleCommandError(mockInteraction, error);

        expect(logger.error).toHaveBeenCalledTimes(2); // Original error and reply error
    });

    test('handles missing interaction properties gracefully', async () => {
        const partialInteraction = {
            reply: jest.fn().mockResolvedValue(undefined),
            // Add minimal required properties
            commandName: undefined,
            user: undefined,
            guild: undefined
        };
        const error = new Error('Test error');

        await handleCommandError(partialInteraction, error);

        // Verify it handles missing properties gracefully
        expect(partialInteraction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('Error ID:'),
            ephemeral: true
        });
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                commandName: undefined,
                userId: undefined,
                guildId: undefined,
                error: expect.any(String)
            }),
            'Unexpected error in command execution'
        );
    });
});
