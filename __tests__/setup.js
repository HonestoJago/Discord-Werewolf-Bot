// Mock Discord.js
jest.mock('discord.js', () => ({
    SlashCommandBuilder: jest.fn().mockImplementation(() => {
        const mockBuilder = {
            setName: jest.fn().mockReturnThis(),
            setDescription: jest.fn().mockReturnThis(),
            addStringOption: jest.fn().mockImplementation(callback => {
                const mockOption = {
                    setName: jest.fn().mockReturnThis(),
                    setDescription: jest.fn().mockReturnThis(),
                    setRequired: jest.fn().mockReturnThis(),
                    addChoices: jest.fn().mockReturnThis()
                };
                callback(mockOption);
                return mockBuilder; // Return the parent builder for chaining
            })
        };
        return mockBuilder;
    }),
    Client: jest.fn(),
    GatewayIntentBits: {
        Guilds: 1,
        GuildMessages: 2,
        MessageContent: 4,
        DirectMessages: 8
    }
}));

// Mock logger
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Clear all mocks after each test
afterEach(() => {
    jest.clearAllMocks();
});
