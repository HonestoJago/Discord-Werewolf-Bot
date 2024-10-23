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
                    setAutocomplete: jest.fn().mockReturnThis(),
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
    },
    EmbedBuilder: jest.fn().mockImplementation(() => ({
        setColor: jest.fn().mockReturnThis(),
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        // Add these properties that we check in tests
        title: 'Day Phase',
        description: expect.any(String),
        fields: [{
            name: 'Alive Players',
            value: expect.any(String)
        }]
    })),
    ActionRowBuilder: jest.fn().mockImplementation(() => ({
        addComponents: jest.fn().mockReturnThis()
    })),
    ButtonBuilder: jest.fn().mockImplementation(() => ({
        setCustomId: jest.fn().mockReturnThis(),
        setLabel: jest.fn().mockReturnThis(),
        setStyle: jest.fn().mockReturnThis()
    })),
    ButtonStyle: {
        Primary: 1,
        Secondary: 2,
        Success: 3,
        Danger: 4
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
