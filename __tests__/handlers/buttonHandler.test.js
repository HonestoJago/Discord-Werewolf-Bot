// Mock dependencies first
jest.mock('../../utils/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
}));

// Import GameError before using it in mocks
const { GameError } = require('../../utils/error-handler');
const logger = require('../../utils/logger');
const { handleAddRole, handleRemoveRole, handleViewRoles } = require('../../handlers/buttonHandler');
const ROLES = require('../../constants/roles');

describe('Button Handler', () => {
    let mockInteraction;
    let mockGame;

    beforeEach(() => {
        mockInteraction = {
            reply: jest.fn().mockResolvedValue(undefined),
            deferUpdate: jest.fn().mockResolvedValue(undefined),
            user: { id: 'userId' },
            guild: { id: 'guildId' },
            customId: 'add_werewolf'  // Default customId
        };

        mockGame = {
            addRole: jest.fn(),
            removeRole: jest.fn().mockImplementation(() => {
                throw new GameError('No Roles', 'There are no roles to remove.');
            }),
            selectedRoles: new Map(),
            gameCreatorId: 'userId'  // Match with mockInteraction.user.id
        };
    });

    describe('handleAddRole', () => {
        test('adds role successfully', async () => {
            await handleAddRole(mockInteraction, mockGame);
            expect(mockGame.addRole).toHaveBeenCalledWith('werewolf');
            expect(mockInteraction.deferUpdate).toHaveBeenCalled();
        });

        test('handles unauthorized users', async () => {
            mockGame.gameCreatorId = 'differentId';
            await handleAddRole(mockInteraction, mockGame);
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'You are not authorized to modify roles.',
                ephemeral: true
            });
        });

        test('handles invalid role names', async () => {
            mockInteraction.customId = 'add_invalidrole';
            await handleAddRole(mockInteraction, mockGame);
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Invalid role selected.',
                ephemeral: true
            });
        });
    });

    describe('handleRemoveRole', () => {
        test('removes role successfully', async () => {
            mockGame.selectedRoles.set('werewolf', 1);
            // Override the mock for this specific test
            mockGame.removeRole = jest.fn().mockResolvedValue(undefined);
            
            await handleRemoveRole(mockInteraction, mockGame);
            expect(mockGame.removeRole).toHaveBeenCalledWith('werewolf');
            expect(mockInteraction.deferUpdate).toHaveBeenCalled();
        });

        test('handles non-existent roles', async () => {
            await handleRemoveRole(mockInteraction, mockGame);
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'There are no roles to remove.',
                ephemeral: true
            });
        });
    });

    describe('handleViewRoles', () => {
        test('displays current role configuration', async () => {
            mockGame.selectedRoles.set('werewolf', 2);
            mockGame.selectedRoles.set('villager', 4);

            await handleViewRoles(mockInteraction, mockGame);
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: expect.stringContaining('Current Roles'),
                ephemeral: true
            });
        });

        test('handles empty role configuration', async () => {
            await handleViewRoles(mockInteraction, mockGame);
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: expect.stringContaining('No roles configured'),
                ephemeral: true
            });
        });
    });

    afterAll(() => {
        jest.clearAllMocks();
        jest.resetModules();
    });
});
