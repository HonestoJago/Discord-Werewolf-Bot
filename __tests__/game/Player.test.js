const { createMockClient } = require('../helpers/discordMocks');
const Player = require('../../game/Player');
const ROLES = require('../../constants/roles');
const { GameError } = require('../../utils/error-handler');

describe('Player', () => {
    let mockClient;
    let player;

    beforeEach(() => {
        mockClient = createMockClient();
        player = new Player('testId', 'testUser', mockClient);
    });

    describe('constructor', () => {
        test('initializes with correct values', () => {
            const player = new Player('testId', 'testUser', mockClient);
            expect(player.id).toBe('testId');
            expect(player.username).toBe('testUser');
            expect(player.client).toBe(mockClient);
            expect(player.role).toBeNull();
            expect(player.isAlive).toBe(true);
            expect(player.isProtected).toBe(false);
            expect(player.channel).toBeNull();
        });
    });

    describe('sendDM', () => {
        test('successfully sends message to living player', async () => {
            await player.sendDM('test message');
            expect(mockClient.users.fetch).toHaveBeenCalledWith('testId');
            const mockUser = await mockClient.users.fetch();
            expect(mockUser.createDM).toHaveBeenCalled();
        });

        test('does not send message to dead player', async () => {
            player.isAlive = false;
            await expect(player.sendDM('test message'))
                .rejects.toThrow('Player is dead');
        });

        test('handles DM channel creation failure', async () => {
            mockClient.users.fetch.mockRejectedValueOnce(new Error('Failed to fetch user'));
            await expect(player.sendDM('test message')).rejects.toThrow(GameError);
        });

        test('handles null message', async () => {
            await expect(player.sendDM(null))
                .rejects.toThrow(GameError);
        });

        test('handles empty message', async () => {
            await player.sendDM('');
            const mockUser = await mockClient.users.fetch();
            const mockDM = await mockUser.createDM();
            expect(mockDM.send).toHaveBeenCalledWith('');
        });

        test('reuses existing DM channel', async () => {
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({})
            };
            player.channel = mockDMChannel;

            await player.sendDM('test');
            expect(mockClient.users.fetch).not.toHaveBeenCalled();
            expect(mockDMChannel.send).toHaveBeenCalledWith('test');
        });
    });

    describe('assignRole', () => {
        test.each([
            [ROLES.WEREWOLF, 'You are a Werewolf!'],
            [ROLES.SEER, 'You are the Seer!'],
            [ROLES.DOCTOR, 'You are the Doctor!'],
            [ROLES.CUPID, 'You are Cupid!'],
            [ROLES.HUNTER, 'You are the Hunter!'],
            [ROLES.VILLAGER, 'You are a Villager!']
        ])('assigns %s role with correct message', async (role, expectedMessage) => {
            await player.assignRole(role);
            expect(player.role).toBe(role);
            const mockUser = await mockClient.users.fetch();
            const mockDM = await mockUser.createDM();
            expect(mockDM.send).toHaveBeenCalledWith(
                expect.stringContaining(expectedMessage)
            );
        });

        test('handles DM failure during role assignment', async () => {
            const mockDMChannel = {
                send: jest.fn().mockRejectedValue(new Error('Failed to send'))
            };
            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });
            
            await expect(player.assignRole(ROLES.WEREWOLF))
                .rejects.toThrow(GameError);
            expect(player.role).toBe(ROLES.WEREWOLF); // Role should still be assigned
        });

        test('rejects invalid role', async () => {
            await expect(player.assignRole('invalid_role'))
                .rejects.toThrow(GameError);
            expect(player.role).toBeNull();
        });
    });

    describe('promptDM', () => {
        test('successfully collects response', async () => {
            const mockResponse = 'test response';
            const mockCollection = {
                first: () => ({ content: mockResponse })
            };
            
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockResolvedValue(mockCollection)
            };

            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });

            player.channel = mockDMChannel;

            const response = await player.promptDM('test prompt');
            expect(response).toBe(mockResponse);
        });

        test('returns null on timeout', async () => {
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockRejectedValue({ message: 'time' })
            };
            
            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });
            
            player.channel = mockDMChannel;
            
            const response = await player.promptDM('test prompt');
            expect(response).toBeNull();
        });

        test('handles filter function correctly', async () => {
            const mockResponse = 'yes';
            const filter = (message) => ['yes', 'no'].includes(message.content.toLowerCase());
            
            const mockCollection = {
                first: () => ({ content: mockResponse })
            };
            
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockImplementation(({ filter }) => {
                    // Test the filter
                    const mockMessage = { content: mockResponse };
                    if (filter(mockMessage)) {
                        return Promise.resolve(mockCollection);
                    }
                    return Promise.reject({ message: 'time' });
                })
            };

            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });

            player.channel = mockDMChannel;

            const response = await player.promptDM('test prompt', filter);
            expect(response).toBe(mockResponse);
        });

        test('handles invalid response format', async () => {
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockResolvedValue({
                    first: () => null  // Invalid response format
                })
            };

            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });

            player.channel = mockDMChannel;

            await expect(player.promptDM('test prompt'))
                .rejects.toThrow('No response');
        });

        test('handles complex filter conditions', async () => {
            const complexFilter = (message) => {
                return message.content.length > 3 && 
                       /^[A-Za-z]+$/.test(message.content);
            };

            const mockCollection = {
                first: () => ({ content: 'validResponse' })
            };

            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockImplementation(({ filter }) => {
                    const mockMessage = { content: 'validResponse' };
                    if (filter(mockMessage)) {
                        return Promise.resolve(mockCollection);
                    }
                    return Promise.reject({ message: 'time' });
                })
            };

            mockClient.users.fetch.mockResolvedValueOnce({
                createDM: jest.fn().mockResolvedValue(mockDMChannel)
            });

            player.channel = mockDMChannel;

            const response = await player.promptDM('test prompt', complexFilter);
            expect(response).toBe('validResponse');
        });

        test('handles custom timeout duration', async () => {
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockResolvedValue({
                    first: () => ({ content: 'response' })
                })
            };
            player.channel = mockDMChannel;

            await player.promptDM('test', null, 5000);
            expect(mockDMChannel.awaitMessages).toHaveBeenCalledWith(
                expect.objectContaining({ 
                    filter: expect.any(Function),
                    max: 1,
                    time: 5000,
                    errors: ['time']
                })
            );
        });
    });

    describe('reset', () => {
        test('resets player state', () => {
            player.role = ROLES.WEREWOLF;
            player.isAlive = false;
            player.isProtected = true;

            player.reset();

            expect(player.role).toBeNull();
            expect(player.isAlive).toBe(true);
            expect(player.isProtected).toBe(false);
        });
    });

    describe('error handling', () => {
        test('propagates non-GameError errors in sendDM', async () => {
            const customError = new Error('Custom error');
            mockClient.users.fetch.mockRejectedValueOnce(customError);
            
            await expect(player.sendDM('test'))
                .rejects.toThrow(GameError);
        });

        test('handles message send failure in promptDM', async () => {
            const mockDMChannel = {
                send: jest.fn().mockRejectedValue(new Error('Send failed')),
                awaitMessages: jest.fn()
            };
            player.channel = mockDMChannel;

            await expect(player.promptDM('test'))
                .rejects.toThrow(GameError);
        });

        test('handles non-timeout errors in promptDM', async () => {
            const mockDMChannel = {
                send: jest.fn().mockResolvedValue({}),
                awaitMessages: jest.fn().mockRejectedValue(new Error('Non-timeout error'))
            };
            player.channel = mockDMChannel;

            await expect(player.promptDM('test'))
                .rejects.toThrow('Non-timeout error');
        });
    });
}); 