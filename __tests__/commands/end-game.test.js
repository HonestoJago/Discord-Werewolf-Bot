const { execute } = require('../../commands/end-game');
const logger = require('../../utils/logger');

describe('end-game command', () => {
    // Setup variables for all tests
    let mockInteraction;
    let mockGameInstance;

    // Before each test, create fresh mock objects
    beforeEach(() => {
        // Mock Discord interaction object
        mockInteraction = {
            user: { id: '123' },  // User who triggered the command
            guildId: '456',       // Discord server ID
            reply: jest.fn(),     // Mock reply function
            // Add client property to interaction
            client: {
                endGame: jest.fn()
            }
        };

        // Mock game instance
        mockGameInstance = {
            gameCreatorId: '123', // Same ID as user to test authorized case
            shutdownGame: jest.fn() // Mock shutdown function
        };
    });

    // Clean up after each test
    afterEach(() => {
        jest.clearAllMocks(); // Reset all mock function calls
    });

    // Test 1: Happy Path - Successful game end
    test('successfully ends game when user is authorized', async () => {
        await execute(mockInteraction, mockGameInstance);

        // Check if game.shutdownGame() was called
        expect(mockGameInstance.shutdownGame).toHaveBeenCalledTimes(1);

        // Check if client.endGame() was called
        expect(mockInteraction.client.endGame).toHaveBeenCalledTimes(1);

        // Verify user got success message
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'The game has been successfully ended and cleaned up.',
            ephemeral: true
        });

        // Verify action was logged
        expect(logger.info).toHaveBeenCalledWith('Game ended by user', {
            userId: '123',
            guildId: '456',
            timestamp: expect.any(String)
        });
    });

    // Test 2: Error Path - No active game
    test('fails when no active game exists', async () => {
        await execute(mockInteraction, null);

        // Verify error message to user
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'There is no active game to end.',
            ephemeral: true
        });

        // Verify error was logged
        expect(logger.error).toHaveBeenCalledWith(
            'Error executing end-game command',
            {
                error: 'No Active Game',
                stack: expect.any(String),
                userId: '123'
            }
        );
    });

    // Test 3: Error Path - Unauthorized user
    test('fails when user is not authorized', async () => {
        mockInteraction.user.id = '789'; // Different user ID than gameCreatorId

        await execute(mockInteraction, mockGameInstance);

        // Verify unauthorized message
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Only the game creator can end the game.',
            ephemeral: true
        });

        // Verify error was logged
        expect(logger.error).toHaveBeenCalledWith(
            'Error executing end-game command',
            {
                error: 'Unauthorized',
                stack: expect.any(String),
                userId: '789'
            }
        );
    });

    // Test 4: Error Path - Shutdown fails
    test('handles shutdown errors gracefully', async () => {
        // Simulate shutdown failure
        const error = new Error('Shutdown failed');
        mockGameInstance.shutdownGame.mockRejectedValue(error);

        await execute(mockInteraction, mockGameInstance);

        // Verify error message to user
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'An error occurred while ending the game.',
            ephemeral: true
        });

        // Verify error was logged with details
        expect(logger.error).toHaveBeenCalledWith(
            'Error executing end-game command',
            {
                error: 'Shutdown failed',
                stack: expect.any(String),
                userId: '123'
            }
        );
    });
});
