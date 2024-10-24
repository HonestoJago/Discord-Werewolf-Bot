const { execute } = require('../../commands/create');
const WerewolfGame = require('../../game/WerewolfGame');
const { createRoleButtons } = require('../../utils/buttonCreator');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/error-handler');
// Add mock for discord.js at the top
jest.mock('discord.js', () => ({
    SlashCommandBuilder: jest.fn().mockImplementation(() => ({
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis()
    })),
    // ... other mocks from before
}));

// Mock dependencies
jest.mock('../../game/WerewolfGame');
jest.mock('../../utils/buttonCreator');
jest.mock('../../utils/logger');
jest.mock('../../utils/error-handler', () => ({
    handleCommandError: jest.fn(),
    GameError: Error
}));

describe('Create Command', () => {
    let mockInteraction;
    
    beforeEach(() => {
        mockInteraction = {
            client: {
                games: new Map()
            },
            guildId: 'testGuild',
            channelId: 'testChannel',
            user: { id: 'testUser' },
            reply: jest.fn().mockResolvedValue(undefined)
        };

        // Mock WerewolfGame constructor
        WerewolfGame.mockImplementation(() => ({
            guildId: 'testGuild',
            gameCreatorId: 'testUser'
        }));

        // Mock createRoleButtons to return proper button rows
        createRoleButtons.mockReturnValue([
            { type: 1, components: [{ customId: 'add_werewolf' }] },
            { type: 1, components: [{ customId: 'remove_werewolf' }] },
            { type: 1, components: [{ customId: 'start_game' }] }
        ]);

        jest.clearAllMocks();
    });

    test('creates new game instance', async () => {
        await execute(mockInteraction);
        
        expect(WerewolfGame).toHaveBeenCalledWith(
            mockInteraction.client,
            'testGuild',
            'testChannel',
            'testUser'
        );
    });

    test('sends welcome message with role configuration', async () => {
        await execute(mockInteraction);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: [expect.objectContaining({
                    title: '🐺 Welcome to Werewolf 🌕',
                    description: expect.stringContaining('Max 1/4 of total players')
                })],
                components: expect.any(Array)
            })
        );
    });

    test('handles errors gracefully', async () => {
        WerewolfGame.mockImplementation(() => {
            throw new Error('Test error');
        });
        
        await execute(mockInteraction);
        
        expect(handleCommandError).toHaveBeenCalled();
    });

    test('includes all required role guidelines', async () => {
        await execute(mockInteraction);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: [expect.objectContaining({
                    title: expect.stringContaining('Welcome to Werewolf'),
                    description: expect.stringContaining('Werewolves: Max 1/4'),
                    fields: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'Current Setup'
                        })
                    ])
                })]
            })
        );
    });

    test('attaches all required button components', async () => {
        await execute(mockInteraction);
        
        expect(mockInteraction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                components: expect.arrayContaining([
                    expect.objectContaining({
                        type: 1,
                        components: expect.any(Array)
                    })
                ])
            })
        );
    });

    test('logs game creation with correct metadata', async () => {
        await execute(mockInteraction);
        
        expect(logger.info).toHaveBeenCalledWith(
            'New game instance created',
            {
                guildId: 'testGuild',
                creatorId: 'testUser'
            }
        );
    });

    test('uses handleCommandError for errors', async () => {
        const testError = new Error('Test error');
        WerewolfGame.mockImplementation(() => {
            throw testError;
        });
        
        await execute(mockInteraction);
        
        expect(handleCommandError).toHaveBeenCalledWith(
            mockInteraction,
            testError
        );
    });
});
